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
    modelos = require('./models/trex-models.js'),
    server = http.createServer(app),
    spawn = require('child_process').spawn;

// Proceso para arrancar y gestionar Mongo
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

// Servidor API
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


//Inicio conexión de mongo
var mongoURL = 'mongodb://localhost/trex';

log('Conectando a base de datos');
log(mongoURL);

var dbTrex = mongoose.createConnection(mongoURL, {db: {safe: true}});

//Modo debug
dbTrex.on('error', console.error.bind(console, 'Error conectando a MongoDB:'));
dbTrex.on("connected", console.info.bind(console, 'Conectado a MongoDB: Trex'));

//Modelos
var models = {
    Serie: dbTrex.model('Serie', modelos.serieDetailSchema),
    Subscription: dbTrex.model('Subscription', modelos.serieSubscription)
    // SerieExtract: dbTrex.model('SerieExtract', modelos.serieExtractSchema),
    // SeriesN: dbTrex.model('SeriesN', modelos.seriesNSchema)
};

//Cargo rutas
require('./routes/trex')(app, models);


// Si no se "queda" en una de las rutas anteriores, devuelvo un 404 siempre
app.use(function (req, res) {
    res.send(404);
});

// El servidor escucha en el puerto 3000
server.listen(port, ip, function () {
    console.log('Node server running on ' + ip + ' ' + port);
});

// Lanzo los procesos de sincronización y chequeo de novedades
var syncUtils = require('./utils/sync');
setTimeout(function () {
    syncUtils.checkSeries(models)
        .then(
            function (data) {
                // Any of the promises was fulfilled.
            }, function (error) {
                // All of the promises were rejected.
            }
        );
}, 5000);

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
        killMongo(pipe);
        process.exit();
    }
}

function killMongo(pipe) {
    pipe.kill('SIGINT');
}

function log(text) {
    if (DEBUG_MODE) {
        console.log(text);
    }
}
