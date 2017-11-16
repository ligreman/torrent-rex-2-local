var extractNewcptChapters = function extractNewcptChapters(pagina, callback) {
    //innerElements.push({name: $(this).text(), url: urlEncoded});
    ////console.log("Pido pagina");
    ////console.log(pagina);
    pagina.request(pagina.url, function (err, resp, body) {
        ////console.log("Paginita");
        if (err) {
            callback(err);
        }

        var $ = pagina.cheerio.load(body),
            capis = [];

        //Cojo la lista de series
        $('ul.buscar-list li').each(function () {
            var a = $(this).find('a');
            var href = a.attr('href');
            var cabecera = $(this).find('div.info').text();
            var h2 = $(this).find('h2').text();
            var urlEncoded;

            ////console.log(title);
            urlEncoded = encodeURI(href);

            if (cabecera !== '') {
                capis.push({
                    header: cabecera.trim(),
                    h2: h2.trim(),
                    url: urlEncoded
                });
            }
        });
//(Serie )(.*)( - )(Temporada (.*))( - )(Temporada\[( )*([0-9]+)( )*\])(Capitulo\[( )*([0-9]+)( )*\])(.*)(\[( )*([A-Z]+)( )*\])(.*)( [0-9\.]+ (MB|GB))
        //Termino
        callback(null, capis);
    });
};

var parseTorrentsNewpct = function parseTorrentsNewpct(torrentList, urlBase, md5) {
    var temporadas = {};

    //Creo las temporadas y demás
    /*title: res[2],
     season: parseInt(9),
     chapter: parseInt(13),
     language: res[15].replace('Calidad', '').trim(),
     format: res[18],
     size: res[21]*/


    var metadata;
    torrentList.forEach(function (torrentArray) {

        torrentArray.forEach(function (torrent) {
            //Saco los metadatos del título
            metadata = extractNewpctMetadata(torrent.header);

            if (metadata !== null) {
                var mTemporada = parseInt(metadata.season);

                if (temporadas[mTemporada] === undefined) {
                    temporadas[mTemporada] = [];
                }

                $url = torrent.url.replace(urlBase, '');

                //Creo la entrada del torrent con los datos de metadatos y los que venian de la lista de torrents
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
            }
        });

    });

    return temporadas;
};


//(.*)( [0-9\.]+ (MB|GB))

var extractNewpctMetadata = function extractNewpctMetadata(txt) {
//Serie American Horror Story - Temporada 4  - Temporada[ 4 ]Capitulo[ 13 ]Español Castellano Calidad [ HDTV ]       16-02-2015       500 MB
    var patt, res, response = {
        title: null, season: null, chapter: null,
        language: null, format: null, size: null
    };

    //Saco el titulo
    patt = /([ a-zA-ZñüáéíóúÁÉÍÓÚ09,\.:;]{3,99999})(-)/;
    res = patt.exec(txt);

    if (res !== null) {
        response.title = res[1].replace('Serie', '').trim();
        if (response.title) {
            response.title = response.title.replace('�', 'ñ');
        }
    }

    //Saco la temporada
    patt = /(Temp\.|Temporada[ ]+)([0-9])+/;
    res = patt.exec(txt);

    if (res !== null) {
        var num = parseInt(res[2].trim());
        if (!isNaN(num)) {
            response.season = num;
        }
    }

    //Saco el capítulo
    patt = /(Cap\.|Capitulo[\[ ]+)([0-9]{1,3})/;
    res = patt.exec(txt);

    if (res !== null) {
        num = res[2].trim();

        //Si es del estilo 607 es que tiene la temporada incluida
        if (num.length > 2) {
            var temp = num.charAt(0);
            var chap = num.charAt(1) + num.charAt(2);

            temp = parseInt(temp);
            chap = parseInt(chap);

            if (!isNaN(temp) && !isNaN(chap)) {
                //Sólo si coinciden las temporadas, como medida de precaución
                if (temp === response.season) {
                    response.chapter = chap;
                }
            }
        } else {
            if (!isNaN(num)) {
                response.chapter = num;
            }
        }
    }

    //Saco el idioma
    patt = /((Español|Spanish)[A-Za-z ]*)/;
    res = patt.exec(txt);

    if (res !== null) {
        num = res[1].replace('Calidad', '').trim();
        if (num) {
            num = num.replace('�', 'ñ');
        }
        response.language = num;
    }

    //Saco la calidad
    patt = /([A-Z]+(RIP|TV))/;
    res = patt.exec(txt);

    if (res !== null) {
        num = res[1].trim();
        response.format = num;
    }

    //Saco el tamaño
    patt = /([0-9]+ MB)/;
    res = patt.exec(txt);

    if (res !== null) {
        num = res[1].trim();
        response.size = num;
    }


    /*
     var patt = /(Serie )(.*)( - )(Temporada (.*))( - )(Temporada\[( )*([0-9]+)( )*\])(Capitulo\[( )*([0-9]+)( )*\])(.*)(\[( )*([A-Z]+)( )*\])(.*)( [0-9\.]+ (MB|GB))/;

     var res = patt.exec(txt), response;

     if (res !== null) {
     response = {
     title: res[2],
     season: parseInt(res[9]),
     chapter: parseInt(res[13]),
     language: res[15].replace('Calidad', '').trim(),
     format: res[18],
     size: res[21]
     };

     ////console.log("METADATA");
     ////console.log(response);
     return response;
     } else {
     return null;
     }
     */
    if (response.title === null || response.season === null || response.chapter === null) {
        return null;
    } else {
        return response;
    }
};


var generateNewpctSeriePage = function generateNewpctSeriePage(url, baseUrl) {
    var patt = /(.*\/(series|series-hd|series-vo)\/)(.*)(\/.*)/;
    var res = patt.exec(url);

//["http://www.newpct1.com/series-hd/american-horror-story/", "http://www.newpct1.com/series-hd/", "series-hd", "american-horror-story", "/"]

    if (res !== null) {
        return baseUrl + 'index.php?page=' + res[2].trim() + '&url=' + res[3].trim() + '/&letter=&pg=';
    } else {
        return null;
    }
};

//Futurama - Temp.6 [HDTV][Cap.601][Spanish]       13-06-2011       275 MB        Descargar
//Smallville - Temporada 7 [DSRRIP][Cap.707][Spanish]       10-11-2008       350 MB        Descargar'

/*var p = [
 "Serie American Horror Story - Temporada 4  - Temporada[ 4 ]Capitulo[ 13 ]Español Castellano Calidad [ HDTV ]       16-02-2015       500 MB",
 "Serie ",
 "American Horror Story",
 " - ",
 "Temporada 4 ",
 "4 ",
 " - ",
 "Temporada[ 4 ]",
 " ",
 "4",
 " ",
 "Capitulo[ 13 ]",
 " ",
 "13",
 " ",
 "Español Castellano Calidad ",
 "[ HDTV ]",
 " ",
 "HDTV",
 " ",
 "       16-02-2015      ",
 " 500 MB",
 "MB"];*/


module.exports = {
    parseTorrentsNewpct: parseTorrentsNewpct,
    extractNewcptChapters: extractNewcptChapters,
    extractNewpctMetadata: extractNewpctMetadata,
    generateNewpctSeriePage: generateNewpctSeriePage
};