/**
 * Sincroniza los datos de base de datos con la fuente
 * @returns {*}
 */

var DEBUG_MODE = true;
var Q = require('q'),
    request = require('request');

var apiUrl = 'http://localhost:8080/api/trex/';

var checkSeries = function (models) {
    var deferred = Q.defer();

    // COjo de Mongo las series a las que estoy suscrito
    models.Subscription.find({})
        .exec(function (err, subscriptions) {
            if (err) {
                console.error("Error rescatando suscripciones de Mongo");
                console.error(err);
                throw err;
            } else {
                // Por cada una, actualizo de la fuente
                subscriptions.forEach(function (subscription) {
                    request(apiUrl + 'serie/' + subscription.serie_id, function (err, resp, body) {
                        if (err) {
                            log('Error autocall pagecount');
                        }

                        // var $ = cheerio.load(body);
                        log(body);
                    });
                });
            }
        });

    deferred.resolve(body);

    // deferred.reject(new Error(error));
    // deferred.resolve(text);
    return deferred.promise;
};


function log(text) {
    if (DEBUG_MODE) {
        console.log(text);
    }
}


module.exports = {
    checkSeries: checkSeries
};
