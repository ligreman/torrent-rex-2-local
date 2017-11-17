'use strict';

var mongoose = require('mongoose'),
    Schema = mongoose.Schema;

var serieExtractSchema = new Schema({
    _id: String,
    name: String
});

var seriesNSchema = new Schema({
    _id: String,
    sd: [serieExtractSchema],
    hd: [serieExtractSchema],
    vo: [serieExtractSchema]
});


var serieDetailSchema = new Schema({
    _id: String,
    name: String,
    url: String,
    source: String,
    lastUpdate: Number,
    seasons: {}
});

var serieSubscription = new Schema({
    _id: String,
    serie_id: String,
    title: String,
    source: String,
    category: String,
    language: String,
    lastSeason: String,
    lastChapter: String,
    excluded: {},
    active: Boolean
});

var serieDownload = new Schema({
    torrentId: String,
    serieId: String,
    title: String,
    retry: Number
});

module.exports = {
    serieDetailSchema: serieDetailSchema,
    serieExtractSchema: serieExtractSchema,
    seriesNSchema: seriesNSchema,
    serieSubscription: serieSubscription,
    serieDownload: serieDownload
};
