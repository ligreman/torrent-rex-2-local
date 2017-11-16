'use strict';

/**
 * - Al añadir serie sacar el nombre de la url (detectar los posibles casos de descargar-serie (vo, hd), todos-los-capitulos...
 * este nombre nos servirá para generar el id md5(nombre). De esta forma si añado la misma serie desde páginas de diferentes
 * capítulos no pasa nada.
 * - La url de la serie será la del capítulo que guarde, da igual. Debería ser igual para todos (newpct).
 *
 */
var newpctUtils = require('./newpct.js'),
    request = require('request'),
    cheerio = require('cheerio'),
    http = require('http'),
    md5 = require('md5'),
    async = require('async'),
    atob = require('atob'),
    btoa = require('btoa');

var urls = {
    'N': 'http://www.newpct.com/'
}, urlsTorrentDownload = {
    //'N': 'http://tumejorserie.com/descargar/index.php?link=torrents/'
    'N': 'http://www.newpct.com/torrents/'
}, urlsSearch = {
    'N': 'http://www.newpct.com/buscar-descargas/'
};


/*
 http://trex-lovehinaesp.rhcloud.com/api/trex/series/vikingos
 */


/*************************************************************************/
/*************** MÉTODOS DEL WEBSERVICE **********************************/
/*************************************************************************/
module.exports = function (models, log) {
    /**
     * GET - Recoge y devuelve todos los torrents de esta serie identificada por su ID
     */
    var getSerieById = function (req, res) {
        var idSerie = req.params.idSerie,
            response = {};

        log("Voy a buscar la serie " + idSerie);

        updateSerie(idSerie, function (error, tempData) {
            log("TERMINO UPDATE");
            log(tempData);
            if (error !== null || tempData === null || tempData === undefined) {
                response = {torrents: null, error: "Se produjo un error"};
                res.send(response);
                throw "Error: 500 - Error al hacer el update";
            }

            log("TEMPDATA");
            log(tempData);
            var nombrecito = tempData.name;
            if (!nombrecito) {
                nombrecito = tempData.titleSmall;
            }

            //Quito duplicados según calidad o capitulos que no son de esta serie
            //var finalTemporadas = removeExtrangeAndDuplicatedChapters(tempData.temporadas, tempData.name, quality);
            var finalTemporadas = tempData.temporadas;

            response = {
                id: idSerie,
                torrents: quitaUrls(finalTemporadas),
                metadata: generateTorrentsData(finalTemporadas, tempData.source),
                error: ""
            };

            log("La respuesta");
            log(response);

            //Respuesta
            eventEmitter.emit('sendResponse', res, response);
        });
    };

    /**
     * GET - Añade una serie via introducir la url
     */
    var addSerie = function (req, res) {
        var source = req.params.source,
            serie = req.params.serie,
            name = req.params.name,
            response = {}, serieUrl = '';

        serie = atob(serie);
        name = atob(name);

        serie = serie.replace(urls['N'], '');
        serie = serie.replace(urls['N1'], '');

        //Compruebo que la url es de una web que espero
        if (serie.indexOf('http://') !== -1 || serie.indexOf('https://') !== -1) {
            response = {torrents: null, error: "Se produjo un error"};
            res.send(response);
            throw "Error: 500";
        }

        log("addSerie " + source + " " + serie + " " + name);

        if (source === 'N' || source === 'N1') {
            serieUrl = urls[source] + serie;
        } else {
            response = {torrents: null, error: "Se produjo un error"};
            res.send(response);
            throw "Error: 500";
        }

        //Obtengo el id de la serie
        var id = md5(source + extractSerieName(serie));
        req.params.idSerie = id;

        log("Añado la serie: " + id);

        //Busco a ver si tengo ya la serie
        models.Serie.findOne({_id: id})
            .exec(function (err, serieMDB) {
                if (err) {
                    console.error("Paso algo");
                    console.error(err);
                    throw err;
                } else {
                    // No la tengo así que la guardo
                    if (serieMDB === null) {
                        log("No tengo la serie aún");
                        //La guardo
                        var laSerie = {
                            _id: id,
                            source: source,
                            url: serieUrl,
                            name: capitalize(name)
                        };
                        log("Genero una serie nueva");
                        log(laSerie);

                        var newSerie = new Serie(laSerie);
                        newSerie.save(function (err) {
                            if (err) {
                                throw err;
                            } else {
                                //Una vez salvada llamo a getSerie
                                getSerieById(req, res);
                            }
                        });
                    } else {
                        //directamente llamo a getSerie
                        getSerieById(req, res);
                    }
                }
            });
    };

    /**
     * GET - Descargo un torrent de una serie y lo envío al plugin
     */
    var getTorrent = function (req, res) {
        var idChapterToDownload = req.params.idChapter,
            idSerie = req.params.idSerie,
            response = {}, chapterToDownload = null;

        //Pido el json de la serie
        updateSerie(idSerie, function (error, tempData) {
            if (error !== null || tempData === null) {
                response = {error: "Se produjo un error"};
                res.status(500).send(response);
                throw "Error: 500";
            }

            log("busco el torrent");
            //Busco el torrent concreto que quiero bajar
            var continuar = true;
            for (var index in tempData.temporadas) {
                if (continuar && tempData.temporadas.hasOwnProperty(index)) {
                    var temporadaChapters = tempData.temporadas[index];

                    temporadaChapters.forEach(function (chapter) {
                        if (chapter._id === idChapterToDownload) {
                            chapterToDownload = chapter;
                            continuar = false;
                        }
                    });
                }
            }

            log("Ya lo tengo lo descargo");
            log(chapterToDownload);
            //Ya tengo el capítulo a bajar así que dependiendo de la fuente lo bajo o tengo que hacer más cosas
            switch (chapterToDownload.source) {
                case 'N1':
                    //Para este caso primero tengo que coger la web del capitulo y el id del torrent de ahí
                    var url = urls['N'] + 'descarga-torrent/' + chapterToDownload.url;
                    log('Consulto la web primero: ' + url);
                    request(url, function (err, resp, body) {
                        if (err) {
                            response = {error: "Se produjo un error"};
                            res.send(response);
                            throw err;
                        }

                        var $ = cheerio.load(body);

                        //Cojo el id del torrent
                        //http://tumejorjuego.com/download/index.php?link=descargar-torrent/38604_salvando-a-grace---temp.3--/
                        var href = $('a.btn-torrent').attr('href');

                        //Extraigo el identificador de la serie
                        href = href.replace('http://tumejorjuego.com/download/index.php?link=descargar-torrent/', '');

                        log('Torrent de newpct');
                        downloadTorrent(res, href, chapterToDownload.title, chapterToDownload.source);
                    });
                    break;
                case 'N':
                    //Para este caso primero tengo que coger la web del capitulo y el id del torrent de ahí
                    var url2 = chapterToDownload.url;

                    log('Consulto la web primero: ' + url2);
                    request(url2, function (err, resp, body) {
                        if (err) {
                            response = {error: "Se produjo un error"};
                            res.send(response);
                            throw err;
                        }

                        var $ = cheerio.load(body);

                        //Cojo el id del torrent
                        //http://tumejorserie.com/descargar/index.php?link=torrents/042969.torrent
                        var href = $('#content-torrent').find('a').attr('href');

                        //Extraigo el identificador de la serie
                        href = href.replace('http://tumejorserie.com/descargar/index.php?link=torrents/', '');

                        log('Torrent de newpct');
                        downloadTorrent(res, href, chapterToDownload.title, chapterToDownload.source);
                    });
                    break;
            }
        });
    };

    /**
     * GET -Busco un torrent
     */
    var searchTorrent = function (req, res) {
        var texto = atob(req.params.text), response = {}, torrentList = [];

        request.post({url: urlsSearch.N, form: {q: texto}}, function (err, resp, body) {
            if (err) {
                response = {error: "Se produjo un error"};
                res.send(response);
                throw err;
            }

            var $ = cheerio.load(body);

            //Cojo la lista
            var lista = $('#categoryTable').find('tbody').find('tr')
                .each(function (i, fila) {
                    var tds = $(this).find('td');

                    var href = $(tds[1]).find('a').attr('href');

                    if (href) {
                        href = btoa(href);
                        torrentList.push({
                            date: sanitize($(tds[0]).text(), true),
                            title: sanitize($(tds[1]).text(), true),
                            url: href,
                            size: sanitize($(tds[2]).text(), true)
                        })
                    }
                });

            response = {
                search: torrentList,
                error: ''
            };

            eventEmitter.emit('sendResponse', res, response);
        });
    };

    /**
     * GET - Descarga un torrent directo
     */
    var getDirectTorrent = function (req, res) {
        var url = atob(req.params.urlTorrent), response = {};

        request(url, function (err, resp, body) {
            if (err) {
                response = {error: "Se produjo un error"};
                res.send(response);
                throw err;
            }

            var $ = cheerio.load(body);

            //Cojo el id del torrent
            //http://tumejorserie.com/descargar/index.php?link=torrents/042969.torrent
            var href = $('#content-torrent').find('a').attr('href');
            var title = $('#title_ficha').find('a').text();

            //Extraigo el identificador de la serie
            href = href.replace('http://tumejorserie.com/descargar/index.php?link=torrents/', '');

            downloadTorrent(res, href, title, 'N');
        });
    };


    //-----------------------------------------------------------------------------------------------
    //-----------------------------------------------------------------------------------------------
    // FUNCIONES AUXILIARES
    //-----------------------------------------------------------------------------------------------
    //-----------------------------------------------------------------------------------------------

    function updateSerie(idSerie, callback) {
        //Miro a ver si tengo la serie en mongo
        models.Serie.findOne({"_id": idSerie})
            .exec(function (err, serie) {
                if (err || serie === null) {
                    callback(null);
                    log("Error al buscar la serie en mongo: " + idSerie);
                    return null;
                } else {
                    log("updateSerie ha encontrado la serie");
                    //Encontré la serie
                    updateSerieContinue(serie, callback);
                }
            });
    }

    function updateSerieContinue(content, callback) {
        var temporadasResponse = {}, $url = '',
            date = new Date(), currentTime = date.getTime(), jsonTime;

        //Si el lastUpdate no han pasado 24 horas no actualizo y devuelvo el contenido del json este
        if (content.lastUpdate !== undefined) {
            log("Se ha actualizado antes alguna vez la serie");
            jsonTime = parseInt(content.lastUpdate, 10);
        } else {
            log("Nunca se había actualizado la serie");
            jsonTime = 0;
        }

        log("El contenido");
        log(content);

        //Si está actualizado y ya tengo los datos devuelvo lo del json
        if (content.seasons !== undefined && Object.keys(content.seasons).length && (currentTime < (jsonTime + 24 * 60 * 60 * 1000))) {
            log('No hace falta actualizar');
            callback(null, {
                temporadas: content.seasons,
                name: content.name,
                source: content.source
            });
            return null;
        }

        //Tengo que actualizar los datos
        $url = content.url;
        log($url);
        //api/trex/torrents/dG9ycmVudHMucGhwP3Byb2Nlc2FyPTEmY2F0ZWdvcmlhcz0nU2VyaWVzJyZzdWJjYXRlZ29yaWE9MTg2NA==/T
        //api/trex/torrents/torrents.php?procesar=1&categorias='Series'&subcategoria=1864/T
        //series-hd/american-horror-story/

        request($url, function (err, resp, body) {
            if (err) {
                callback(null);
                return null;
            }

            var $ = cheerio.load(body);
            var innerTorrents = [], paginas = [], numpags, category;

            //Cojo la lista torrents dependiendo de la fuente.
            //NewPCT1
            if (content.source === 'N1') {
                //Saco el número de páginas que hay para poder procesarlas
                numpags = $('ul.pagination li').length;
                category = 'Serie';

                //Provisionalmente miro si es HD o VO, en cuyo caso sólo puedo mirar la página 1 que no funciona la paginación //TODO
                if ($url.indexOf('series-hd') > -1) {
                    numpags = 0;
                    category = 'Serie HD'
                }
                if ($url.indexOf('series-vo') > -1) {
                    numpags = 0;
                    category = 'Serie V.O.'
                }

                log("Num pags: " + numpags);

                //Miro si hay más páginas o no
                if (numpags === 0) {
                    //No hay más
                    paginas.push({url: $url, type: category, request: request, cheerio: cheerio});
                } else {
                    //Hay más
                    numpags = numpags - 2; //elimino los enlaces Next y Last

                    $url = newpctUtils.generateNewpctSeriePage($url, urls['N']);

                    //Construyo los enlaces
                    for (var i = 1; i <= numpags; i++) {
                        paginas.push({url: $url + i, type: category, request: request, cheerio: cheerio});
                    }
                }

                log("PAGINAS");
                log(paginas);

                log('    Ahora saco los capítulos');

                //Cojo la información de las páginas
                async.map(paginas, newpctUtils.extractNewcptChapters, function (err, results) {
                    if (err) {
                        log('Error al obtener los capitulos de newpct1: ' + err);
                    }

                    //Tengo en results un array de arrays url + cabecera
                    log("RESULTADOOOOOOOS");
                    log(results);

                    //Recorro los results extrayendo la información
                    temporadasResponse = newpctUtils.parseTorrentsNewpct(results, urls['N'], md5);

                    //Actualizo datos en variable content
                    //content.seasons = temporadasResponse;
                    //content.lastUpdate = date.getTime();

                    var contentUpdated = {
                        //_id: content._id,
                        //id: content.id,
                        source: content.source,
                        name: content.name,
                        url: content.url,
                        seasons: temporadasResponse,
                        lastUpdate: date.getTime()
                    };

                    //Guardo en Mongo
                    models.Serie.update({"_id": content._id}, contentUpdated, function (err) {
                        if (err) {
                            log("Error actualizando la serie N1 en mongo: " + err);
                            callback(err);
                        } else {
                            log("CALLBACK");
                            callback(null, {
                                temporadas: temporadasResponse,
                                source: contentUpdated.source
                            });
                        }
                    });
                });
            }
            //�
            //NewPCT
            if (content.source === 'N') {
                log("Página de newp original");

                var patron = /(.*) - (Temp\.|Temporada )([0-9]+) \[([A-Za-z 0-9]+)]\[([a-zA-Z \.0-9]+)](.+)/;

                //Saco la lista de temporadas y capítulos del menú izquierdo
                $('div#content-temp ul li ul li a').each(function () {
                    var enlace = $(this).attr('href');
                    var title = $(this).attr('title');

                    //enlace = enlace.replace(urls['N'], '');

                    log('patron: ' + patron);
                    log('title: ' + title);

                    var trozos = patron.exec(title);

                    //Compruebo que obtengo los trozos que quería
                    if (trozos && trozos.length === 7) {
                        var mTemporada = parseInt(trozos[3]);

                        var capi = trozos[5].substr(-2); //los dos últimos dígitos son el capi

                        log("Trozos");
                        log(trozos);

                        if (temporadasResponse[mTemporada] === undefined) {
                            temporadasResponse[mTemporada] = [];
                        }

                        if (title) {
                            title = title.replace('�', 'ñ');
                        }

                        var titleSmall = trozos[1];
                        if (titleSmall) {
                            titleSmall = titleSmall.replace('�', 'ñ');
                        }

                        temporadasResponse[mTemporada].push({
                            _id: md5('N' + trozos[1] + enlace),
                            //torrentId: null,
                            url: enlace,
                            title: title,
                            titleSmall: titleSmall,
                            chapter: parseInt(capi),
                            language: sanitize(trozos[6].replace('[', '').replace(']', '')),
                            format: trozos[4],
                            source: 'N',
                            size: ''
                        });
                    }
                });
                /*
                 C.S.I. Las Vegas - Temp.9 [HDTV][Cap.901][Spanish]
                 C.S.I. Las Vegas - Temporada 8 [HDTV][Cap.817][Spanish]

                 temporadas[mTemporada].push({
                 id: md5('N' + metadata.title + $url),
                 torrentId: null,
                 url: $url,
                 title: torrent.h2.replace('Serie ', ''),
                 titleSmall: metadata.title,
                 chapter: parseInt(metadata.chapter),
                 language: metadata.language,
                 format: metadata.format,
                 source: 'N',
                 size: metadata.size
                 });
                 */

                //Actualizo datos en variable content
                //content.seasons = temporadasResponse;
                //content.lastUpdate = date.getTime();

                var contentUpdated = {
                    //_id: content._id,
                    //id: content.id,
                    source: content.source,
                    name: content.name,
                    url: content.url,
                    seasons: temporadasResponse,
                    lastUpdate: date.getTime()
                };

                //Guardo en Mongo
                Serie
                    .update({"_id": content._id}, contentUpdated, function (err) {
                        if (err) {
                            log("Error actualizando la serie N en mongo: " + err);
                            callback(err);
                        } else {
                            log("CALLBACK");
                            callback(null, {
                                temporadas: temporadasResponse,
                                source: contentUpdated.source
                            });
                        }
                    });
            }
        });
    }

    function downloadTorrent(res, idTorrent, titleTorrent, source) {
        var $url = urlsTorrentDownload[source] + idTorrent;

        log("Descargo torrent: " + $url);

        http.get($url, function (resp) {
            if (resp.statusCode !== 200) {
                //log(resp);
                var response = {error: "Se produjo un error", status: resp.statusCode};
                res.status(500).send(response);
                throw "Error: 500";
            } else {
                log(resp.headers);
                var disposition = resp.headers['content-disposition'],
                    content = resp.headers['content-type'];

                if (disposition === undefined) {
                    disposition = 'attachment; filename="' + titleTorrent + '.torrent';
                }
                if (content === undefined) {
                    content = 'application/octet-stream';
                }
                log("content: " + content);
                log("dispo:" + disposition);
                res.set({
                    'Content-Type': content,
                    'Content-Disposition': disposition
                });

                resp.on('data', function (chunk) {
                    res.write(chunk);
                }).on('end', function () {
                    res.end();
                });
            }
        });

    }

    function generateTorrentsData(temporadas, source) {
        var resp = {}, $lastSeason = 0, $numSeasons = 0;

        resp.seasonsDetail = {};

        log("Da temps");
        log(temporadas);

        for (var index in temporadas) {
            if (temporadas.hasOwnProperty(index) && temporadas[index]) {
                var temp = temporadas[index];

                var $lastChapter = 0;
                temp.forEach(function (chapter) {
                    var currentChap = parseInt(chapter.chapter, 10);
                    if ($lastChapter < currentChap) {
                        $lastChapter = currentChap;
                    }
                });

                resp.seasonsDetail[index] = {
                    chapters: temp.length,
                    lastChapter: $lastChapter
                };

                if ($lastSeason < index) {
                    $lastSeason = index;
                }

                $numSeasons++;
            }
        }

        resp.seasons = $numSeasons;
        resp.lastSeason = $lastSeason;
        resp.source = source;
        return resp;
    }


    /**
     * Intento sacar el nombre de la serie
     * http://www.newpct.com/descargar-serie/gotham/capitulo-211/ -- aHR0cDovL3d3dy5uZXdwY3QuY29tL2Rlc2Nhcmdhci1zZXJpZS9nb3RoYW0vY2FwaXR1bG8tMjExLw==
     * http://www.newpct.com/descargar-seriehd/gotham/capitulo-211/
     * http://www.newpct.com/descargar-serievo/supergirl/capitulo-113/
     * http://www.newpct.com/todos-los-capitulos/series/gotham/
     */
    function extractSerieName(url) {
        var name = '';
        //Compruebo la fuente
        if (url.indexOf(urls['N']) !== -1) {
            // Es newpct
            var patron = /(http:\/\/www.newpct.com\/)(descargar-serie(hd|vo)?|todos-los-capitulos\/series)\/([A-Za-z0-9-]+)/g;
            var trozos = patron.exec(url); // el 4 es el nombre

            if (trozos.length === 5) {
                name = trozos[4];
            } else {
                name = url;
            }
        } else {
            name = url;
        }

        return name;
    }

    function capitalize(name) {
        name = normalizeName(name);
        return name.charAt(0).toUpperCase() + name.slice(1);
    }

    function normalizeName(name) {
        return name.toLowerCase().replace(/-(.)/g, function (match, group1) {
            return ' ' + group1.toUpperCase();
        });
    }

    function sanitize(text, extra) {
        if (!text) {
            return null;
        }

        //Dejo sólo alfanuméricos
        if (extra) {
            text = text.replace(/[^a-zA-ZñáéíóúüÁÉÍÓÚÜ0-9\[\] \.\-_\+\(\)]/g, "");
        } else {
            text = text.replace(/[^a-zA-ZñáéíóúüÁÉÍÓÚÜ0-9 ]/g, "");
        }
        text = text.replace('�', 'ñ');

        text = text.replace('Espaol', 'Español');

        return text.trim();
    }

    function quitaUrls(temporadas) {
        for (var index in temporadas) {
            if (temporadas.hasOwnProperty(index)) {
                var temporada = temporadas[index];

                temporada.forEach(function (capi) {
                    // Quito la url
                    capi.url = '';
                });

                temporadas[index] = temporada;
            }
        }
        return temporadas;
    }

    return {
        getSerieById: getSerieById,
        getTorrent: getTorrent,
        addSerie: addSerie,
        searchTorrent: searchTorrent,
        getDirectTorrent: getDirectTorrent
    }
};
