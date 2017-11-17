'use strict';
var DEBUG_MODE = true;

// Dependencias
var express = require('express'),
    app = express(),
    compression = require('compression'),
    bodyParser = require('body-parser'),
    http = require('http'),
    morgan = require('morgan'),
    mongoose = require('mongoose'),
    server = http.createServer(app),
    spawn = require('child_process').spawn,
    events = require('events');

// Modo de ejecución
var args = process.argv.slice(2);
var syncMode = false;
if (args[0] === 'sync') {
    syncMode = true;
}

/******************************************************************/
/******************** MONGODB *************************************/
/******************************************************************/
var pipe = spawn('mongod', ['--config', 'C:\\Programas\\MongoDB3\\mongo.conf']);

pipe.stdout.on('data', function (data) {
    console.log('Datos:' + data.toString('utf8'));
});

pipe.stderr.on('data', function (data) {
    console.log('Datos:' + data.toString('utf8'));
});

pipe.on('close', function (code) {
    console.log('Mongo process exited with code: ' + code);
});

//Inicio conexión de mongo
var mongoURL = 'mongodb://localhost/trex';

log('Conectando a base de datos');
log(mongoURL);

var dbTrex = mongoose.createConnection(mongoURL, {db: {safe: true}});

//Modo debug
dbTrex.on('error', console.error.bind(console, 'Error conectando a MongoDB:'));
dbTrex.on("connected", console.info.bind(console, 'Conectado a MongoDB: Trex'));

//Modelos
var modelDB = require('./models/model.js');
var models = {
    Serie: dbTrex.model('Serie', modelDB.serieDetailSchema),
    Subscription: dbTrex.model('Subscription', modelDB.serieSubscription),
    Downloads: dbTrex.model('Subscription', modelDB.serieDownload)
    // SerieExtract: dbTrex.model('SerieExtract', modelDB.serieExtractSchema),
    // SeriesN: dbTrex.model('SeriesN', modelDB.seriesNSchema)
};


/******************************************************************/
/******************** API SERVER **********************************/
/******************************************************************/
var port = 8080, ip = 'localhost';

// Configuramos la app para que pueda realizar métodos REST
app.use(bodyParser.json());
app.use(compression());
app.use(morgan('combined'));

// CORSAdd headers
app.use(function (req, res, next) {
    // Website you wish to allow to connect
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost');
    // Request methods you wish to allow
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    // Request headers you wish to allow
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
    // Set to true if you need the website to include cookies in the requests sent
    // to the API (e.g. in case you use sessions)
    res.setHeader('Access-Control-Allow-Credentials', true);

    // Pass to next layer of middleware
    next();
});


/******************************************************************/
/******************** RUTAS API ***********************************/
/******************************************************************/
var torrent = require('./modules/torrent.js')(models, log);
//Las rutas
app.get('/api/trex/serie/:idSerie', torrent.getSerieById);   //Lista de temporadas y capítulos de una serie. Quality: low,high
app.get('/api/trex/download/:idSerie/:idChapter', torrent.getTorrent);   //Descarga de series de T y N
app.get('/api/trex/addSerie/:source/:serie/:name', torrent.addSerie); //Añade serie por url. Source: N - N1. Serie: url. Name: nombre

app.get('/api/trex/search/:text', torrent.searchTorrent); //Busca torrents
app.get('/api/trex/downloadTorrent/:urlTorrent', torrent.getDirectTorrent); //Descarga de torrents buscados

// Check status
app.get('/pagecount', function (req, res) {
    res.send('ok');
});


/*************************************************************************/
/********************* LISTENER EVENTOS GENERALES ************************/
/*************************************************************************/
var eventEmitter = new events.EventEmitter();

//Envío una respuesta JSON
eventEmitter.on('sendResponse', function (responseObject, responseJSON) {
    log("Envio respuesta");
    responseObject.set({
        'Content-Type': 'application/json; charset=utf-8'
    }).json(responseJSON);
});

//Envío un torrent como respuesta
eventEmitter.on('sendTorrent', function (responseObject, disposition, content, responseTorrent) {
    responseObject.set({
        'Content-Type': content,
        'Content-Disposition': disposition
    });

    responseObject.write(responseTorrent);
    responseObject.end();
});


/******************************************************************/
/************ ERRORES Y PROCESOS AUTOMÁTICOS **********************/
/******************************************************************/
// Si no se "queda" en una de las rutas anteriores, devuelvo un 404 siempre
app.use(function (req, res) {
    res.send(404);
});

// El servidor escucha en el puerto 3000
server.listen(port, ip, function () {
    console.log('Node server running on ' + ip + ' ' + port);
});

// Lanzo los procesos de sincronización y chequeo de novedades
/*var syncUtils = require('./modules/sync');
setTimeout(function () {
    syncUtils.checkSeries(models)
        .then(
            function (data) {
                // Any of the promises was fulfilled.
            }, function (error) {
                // All of the promises were rejected.
            }
        );
}, 5000);*/

if (syncMode) {
    setTimeout(function () {

        // Saco las suscripciones
        models.Subscription.find({})
            .exec(function (err, subscriptions) {
                if (err) {
                    console.error("Error rescatando suscripciones de Mongo");
                    console.error(err);
                    throw err;
                } else {
                    // Por cada una, actualizo de la fuente
                    subscriptions.forEach(function (subscription) {
                        torrent.getSerieById(null, null, subscription.serie_id, checkNewChapters);
                    });
                }
            });
    }, 5000);
}


function checkNewChapters(temporadas) {
    // Torrents nuevos que tengo que descargar
    var newTorrents = [];

    if (temporadas !== null) {
        // Si tengo las temporadas, comparo con la suscripción a ver si hay algo nuevo
        var season, lastSeasonReal = subscription.lastSeason, lastChapterReal = subscription.lastChapter;

        for (var seasonKey in temporadas.torrents) {
            if (temporadas.torrents.hasOwnProperty(seasonKey)) {
                season = temporadas.torrents[seasonKey];
                seasonKey = parseInt(seasonKey);
                var newSeason = false;

                //Si la temporada es mayor que la antigua, cogeré todos sus capítulos
                if (seasonKey > subscription.lastSeason) {
                    newSeason = true;
                    // Reseteo el último capi ya que hay temp nueva y tengo que pillar todo de ella.
                    lastChapterReal = 0;
                }

                //Si están en la temporada última que he descargado o más avanzado sigo
                if (seasonKey >= subscription.lastSeason) {

                    //Recorro los capitulos de la sesión
                    season.forEach(function (thisChapter) {
                        // Si es capítulo más reciente de esta temporada, o es una temp nueva
                        if ((thisChapter.chapter > subscription.lastChapter) || newSeason) {
                            //Lo añado a la lista de descargas
                            newTorrents.push({
                                torrentId: thisChapter._id,
                                title: thisChapter.title,
                                serieId: subscription.serie_id,
                                retry: 0
                            });

                            //Actualizo la variable de series
                            lastChapterReal = Math.max(thisChapter.chapter, lastChapterReal);
                        }
                    });

                    //Actualizo la variable de temporada
                    lastSeasonReal = Math.max(seasonKey, lastSeasonReal);
                }
            }
        }

        //Actualizo la temporda y capitulo últimos
        subscription.lastChapter = lastChapterReal;
        subscription.lastSeason = lastSeasonReal;

        // Guardo esta suscripción actualizada
        subscription.save();
    } else {
        console.error("Error al obtener las temporadas de la serie: " + subscription.title);
    }

    // Si hay nuevos torrents
    if (newTorrents !== null && newTorrents.length > 1) {
        for (var i = 0, j = newTorrents.length; i < j; i++) {
            //Añado el torrent a la lista de descargas
            models.Downloads.insertMany(newTorrents)
                .then(function (mongooseDocuments) {
                })
                .catch(function (err) {
                });
        }
    }
}


//Si salta alguna excepción rara, saco error en vez de cerrar la aplicación
process.on('uncaughtException', function (err) {
    // handle the error safely
    console.log("ERROR - " + err);
});

//Controlamos el cierre para desconectar mongo
process.stdin.resume();//so the program will not close instantly

//do something when app is closing
process.on('exit', exitHandler.bind(null, {exit: true}));
//catches ctrl+c event
//En caso de error desconecto de mongo
process.on('SIGINT', exitHandler.bind(null, {exit: true}));
process.on('SIGTERM', exitHandler.bind(null, {exit: true}));


function exitHandler(options, err) {
    if (options.exit) {
        dbTrexDisconnect();
        killMongo(pipe);
        process.exit();
    }
}

function killMongo(pipe) {
    pipe.kill('SIGINT');
}

function dbTrexDisconnect() {
    mongoose.disconnect();
}

function log(text) {
    if (DEBUG_MODE) {
        console.log(text);
    }
}
