(function () {

/* Imports */
var Meteor = Package.meteor.Meteor;
var global = Package.meteor.global;
var meteorEnv = Package.meteor.meteorEnv;
var DDP = Package['ddp-client'].DDP;
var DDPServer = Package['ddp-server'].DDPServer;
var Random = Package.random.Random;
var LocalCollection = Package.minimongo.LocalCollection;
var Minimongo = Package.minimongo.Minimongo;
var _ = Package.underscore._;
var MongoInternals = Package.mongo.MongoInternals;
var Mongo = Package.mongo.Mongo;

/* Package-scope variables */
var FindFaster, FastRead;

(function(){

//////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                  //
// packages/arunoda_find-faster/packages/arunoda_find-faster.js                                     //
//                                                                                                  //
//////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                    //
(function () {

///////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                           //
// packages/arunoda:find-faster/lib/server.js                                                //
//                                                                                           //
///////////////////////////////////////////////////////////////////////////////////////////////
                                                                                             //
FindFaster = {};                                                                             // 1
                                                                                             // 2
FindFaster._dummyColl = new Meteor.Collection('__dummy_collection_' + Random.id());          // 3
FindFaster._lastTimeObserverUsed = {};                                                       // 4
FindFaster._keepHandles = {};                                                                // 5
                                                                                             // 6
FindFaster._getCursorProto = _.once(getCursorProto);                                         // 7
FindFaster._getOplogObserveDriverClass = _.once(getOplogObserveDriverClass);                 // 8
FindFaster._fetch = fetch;                                                                   // 9
FindFaster._canUseFindFaster = canUseFindFaster;                                             // 10
FindFaster._getExpectedDocs = getExpectedDocs;                                               // 11
                                                                                             // 12
FindFaster.defaultExpectedDocs  = 1;                                                         // 13
FindFaster.expectedDocs = new Meteor.EnvironmentVariable();                                  // 14
FindFaster.timeout = 5 * 1000;                                                               // 15
                                                                                             // 16
function canUseFindFaster(cursor) {                                                          // 17
  var condition =                                                                            // 18
    cursor._cursorDescription.options.findFaster &&                                          // 19
    FindFaster._getOplogObserveDriverClass() &&                                              // 20
    canUseOplog(cursor._cursorDescription, FindFaster._getOplogObserveDriverClass());        // 21
                                                                                             // 22
  return !!condition;                                                                        // 23
}                                                                                            // 24
                                                                                             // 25
function canUseOplog(cursorDescription, OplogObserveDriver) {                                // 26
  var matcher;                                                                               // 27
  var sorter;                                                                                // 28
                                                                                             // 29
  // stolen and modified from Meteor's mongo-livedata                                        // 30
  var canUseOplog = _.all([                                                                  // 31
    function () {                                                                            // 32
      // We need to be able to compile the selector. Fall back to polling for                // 33
      // some newfangled $selector that minimongo doesn't support yet.                       // 34
      try {                                                                                  // 35
        matcher = new Minimongo.Matcher(cursorDescription.selector);                         // 36
        return true;                                                                         // 37
      } catch (e) {                                                                          // 38
        // XXX make all compilation errors MinimongoError or something                       // 39
        //     so that this doesn't ignore unrelated exceptions                              // 40
        return false;                                                                        // 41
      }                                                                                      // 42
    }, function () {                                                                         // 43
      // ... and the selector itself needs to support oplog.                                 // 44
      return OplogObserveDriver.cursorSupported(cursorDescription, matcher);                 // 45
    }, function () {                                                                         // 46
      // And we need to be able to compile the sort, if any.  eg, can't be                   // 47
      // {$natural: 1}.                                                                      // 48
      if (!cursorDescription.options.sort)                                                   // 49
        return true;                                                                         // 50
      try {                                                                                  // 51
        sorter = new Minimongo.Sorter(cursorDescription.options.sort,                        // 52
                                      { matcher: matcher });                                 // 53
        return true;                                                                         // 54
      } catch (e) {                                                                          // 55
        // XXX make all compilation errors MinimongoError or something                       // 56
        //     so that this doesn't ignore unrelated exceptions                              // 57
        return false;                                                                        // 58
      }                                                                                      // 59
    }], function (f) { return f(); });  // invoke each function                              // 60
                                                                                             // 61
  return canUseOplog;                                                                        // 62
}                                                                                            // 63
                                                                                             // 64
function getCursorProto() {                                                                  // 65
  // allow Meteor to connect to Mongo and initialze the connection                           // 66
  FindFaster._dummyColl.findOne();                                                           // 67
  var cursor = FindFaster._dummyColl.find();                                                 // 68
  return cursor.constructor.prototype;                                                       // 69
};                                                                                           // 70
                                                                                             // 71
function getOplogObserveDriverClass() {                                                      // 72
  var cursor = FindFaster._dummyColl.find();                                                 // 73
  if(cursor._mongo._oplogHandle) {                                                           // 74
    // we need to waitUntil, oplog driver gets initialized                                   // 75
    // otherwise we counldn't get the OplogDriver                                            // 76
    cursor._mongo._oplogHandle.waitUntilCaughtUp();                                          // 77
    var handle = FindFaster._dummyColl.find({}).observeChanges({                             // 78
      added: function() {}                                                                   // 79
    });                                                                                      // 80
                                                                                             // 81
    var driverClass = handle._multiplexer._observeDriver.constructor;                        // 82
    handle.stop();                                                                           // 83
                                                                                             // 84
    return driverClass;                                                                      // 85
  }                                                                                          // 86
}                                                                                            // 87
                                                                                             // 88
function fetch(cursor, dontClone) {                                                          // 89
  var observeKey = JSON.stringify(_.extend({ordered: false}, cursor._cursorDescription));    // 90
                                                                                             // 91
  if(!FindFaster._lastTimeObserverUsed[observeKey]) {                                        // 92
    // creating a new cursor with removing FindFaster option to avoid locking                // 93
    // and using FindFaster inside the observeChanges                                        // 94
    var cursorDescription = EJSON.clone(cursor._cursorDescription);                          // 95
    delete cursorDescription.options.findFaster;                                             // 96
    var newCursor = new (cursor.constructor)(cursor._mongo, cursorDescription);              // 97
    FindFaster._keepHandles[observeKey] = newCursor.observeChanges({added: function() {}});  // 98
                                                                                             // 99
    timeoutKeepObserver(cursor, observeKey);                                                 // 100
  }                                                                                          // 101
                                                                                             // 102
  FindFaster._lastTimeObserverUsed[observeKey] = Date.now();                                 // 103
  // since FindFaster is eventual consistancy                                                // 104
  // asking expectedDocs values makes us to make FindFaster closer                           // 105
  // to strong consistancy for simple fetchs like _id                                        // 106
  var expectedDocs = FindFaster._getExpectedDocs(cursor);                                    // 107
                                                                                             // 108
  //transform function                                                                       // 109
  var transform = cursor.getTransform();                                                     // 110
  if(transform) {                                                                            // 111
    transform = LocalCollection.wrapTransform(transform);                                    // 112
  }                                                                                          // 113
                                                                                             // 114
  var multiplexer = FindFaster._keepHandles[observeKey]._multiplexer;                        // 115
  var docs = getDocsFromMultiflexer(multiplexer, dontClone, transform);                      // 116
  if(docs.length >= expectedDocs) {                                                          // 117
    return docs;                                                                             // 118
  } else {                                                                                   // 119
    cursor._mongo._oplogHandle.waitUntilCaughtUp();                                          // 120
    return getDocsFromMultiflexer(multiplexer, dontClone, transform);                        // 121
  }                                                                                          // 122
}                                                                                            // 123
                                                                                             // 124
function getDocsFromMultiflexer(multiplexer, dontClone, transform) {                         // 125
  var docs = [];                                                                             // 126
  multiplexer._queue.runTask(function() {                                                    // 127
    if(dontClone) {                                                                          // 128
      docs = multiplexer._cache.docs;                                                        // 129
    } else {                                                                                 // 130
      multiplexer._cache.docs.forEach(function(doc) {                                        // 131
        doc = EJSON.clone(doc);                                                              // 132
        doc = (transform)? transform(doc): doc;                                              // 133
        docs.push(doc);                                                                      // 134
      });                                                                                    // 135
    }                                                                                        // 136
  });                                                                                        // 137
  return docs;                                                                               // 138
}                                                                                            // 139
                                                                                             // 140
function getExpectedDocs(cursor) {                                                           // 141
  if(cursor._cursorDescription.options.expectedDocs) {                                       // 142
    return cursor._cursorDescription.options.expectedDocs;                                   // 143
  } else if(FindFaster.expectedDocs.get()) {                                                 // 144
    return FindFaster.expectedDocs.get();                                                    // 145
  } else {                                                                                   // 146
    return FindFaster.defaultExpectedDocs;                                                   // 147
  }                                                                                          // 148
}                                                                                            // 149
                                                                                             // 150
function timeoutKeepObserver(cursor, observeKey) {                                           // 151
  var lastTimeObserved = FindFaster._lastTimeObserverUsed[observeKey] || Date.now();         // 152
  var timeoutValue = (lastTimeObserved + FindFaster.timeout) - Date.now();                   // 153
                                                                                             // 154
  if(timeoutValue > 0) {                                                                     // 155
    setTimeout(function() {                                                                  // 156
      timeoutKeepObserver(cursor, observeKey);                                               // 157
    }, timeoutValue);                                                                        // 158
  } else {                                                                                   // 159
    FindFaster._keepHandles[observeKey].stop();                                              // 160
    FindFaster._keepHandles[observeKey] = null;                                              // 161
    FindFaster._lastTimeObserverUsed[observeKey] = null;                                     // 162
  }                                                                                          // 163
}                                                                                            // 164
///////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function () {

///////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                           //
// packages/arunoda:find-faster/lib/override.js                                              //
//                                                                                           //
///////////////////////////////////////////////////////////////////////////////////////////////
                                                                                             //
var cursorProto = FindFaster._getCursorProto();                                              // 1
var collectionProto = Meteor.Collection.prototype;                                           // 2
                                                                                             // 3
//fetch                                                                                      // 4
var originalFetch = cursorProto.fetch;                                                       // 5
cursorProto.fetch = function() {                                                             // 6
  if(FindFaster._canUseFindFaster(this)) {                                                   // 7
    return FindFaster._fetch(this);                                                          // 8
  } else {                                                                                   // 9
    return originalFetch.apply(this, arguments);                                             // 10
  }                                                                                          // 11
};                                                                                           // 12
                                                                                             // 13
//forEach                                                                                    // 14
var originalForEach = cursorProto.forEach;                                                   // 15
cursorProto.forEach = function(callback, thisArg) {                                          // 16
  if(FindFaster._canUseFindFaster(this)) {                                                   // 17
    var docs = FindFaster._fetch(this);                                                      // 18
    var cursor = this;                                                                       // 19
                                                                                             // 20
    docs.forEach(function(doc, index) {                                                      // 21
      callback.call(thisArg, doc, index, cursor);                                            // 22
    });                                                                                      // 23
  } else {                                                                                   // 24
    return originalForEach.apply(this, arguments);                                           // 25
  }                                                                                          // 26
};                                                                                           // 27
                                                                                             // 28
// Map                                                                                       // 29
var originalMap = cursorProto.map;                                                           // 30
cursorProto.map = function(callback, thisArg) {                                              // 31
  if(FindFaster._canUseFindFaster(this)) {                                                   // 32
    var result = [];                                                                         // 33
    var cursor = this;                                                                       // 34
                                                                                             // 35
    var docs = FindFaster._fetch(this);                                                      // 36
    docs.forEach(function(doc, index) {                                                      // 37
      result.push(callback.call(thisArg, doc, index, cursor));                               // 38
    });                                                                                      // 39
    return result;                                                                           // 40
  } else {                                                                                   // 41
    return originalMap.call(this, callback, thisArg);                                        // 42
  }                                                                                          // 43
};                                                                                           // 44
                                                                                             // 45
// Extending Meteor.Collection                                                               // 46
collectionProto.findFaster = function(selector, options) {                                   // 47
  var args = _.toArray(arguments);                                                           // 48
  selector = this._getFindSelector(args)                                                     // 49
  options = this._getFindOptions(args)                                                       // 50
                                                                                             // 51
  options.findFaster = true;                                                                 // 52
  return this.find(selector, options);                                                       // 53
};                                                                                           // 54
                                                                                             // 55
collectionProto.findOneFaster = function(selector, options) {                                // 56
  var args = _.toArray(arguments);                                                           // 57
  selector = this._getFindSelector(args)                                                     // 58
  options = this._getFindOptions(args)                                                       // 59
                                                                                             // 60
  options.findFaster = true;                                                                 // 61
  // this is need since, Meteor rejects to use oplog                                         // 62
  // if there is no sort specifier                                                           // 63
  options.sort = options.sort || {_id: 1};                                                   // 64
  return this.findOne(selector, options);                                                    // 65
};                                                                                           // 66
                                                                                             // 67
///////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);

//////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);


/* Exports */
if (typeof Package === 'undefined') Package = {};
(function (pkg, symbols) {
  for (var s in symbols)
    (s in pkg) || (pkg[s] = symbols[s]);
})(Package['arunoda:find-faster'] = {}, {
  FastRead: FastRead
});

})();
