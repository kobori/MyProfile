(function () {

/* Imports */
var Meteor = Package.meteor.Meteor;
var global = Package.meteor.global;
var meteorEnv = Package.meteor.meteorEnv;
var meteorInstall = Package.modules.meteorInstall;
var Promise = Package.promise.Promise;
var DDP = Package['ddp-client'].DDP;
var DDPServer = Package['ddp-server'].DDPServer;
var check = Package.check.check;
var Match = Package.check.Match;
var ECMAScript = Package.ecmascript.ECMAScript;
var meteorBabelHelpers = Package['babel-runtime'].meteorBabelHelpers;

var require = meteorInstall({"node_modules":{"meteor":{"dynamic-import":{"server.js":function(require,exports,module){

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                              //
// packages/dynamic-import/server.js                                                                            //
//                                                                                                              //
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                //
const module1 = module;
let assert;
module1.watch(require("assert"), {
  default(v) {
    assert = v;
  }

}, 0);
let readFileSync;
module1.watch(require("fs"), {
  readFileSync(v) {
    readFileSync = v;
  }

}, 1);
let pathJoin, pathNormalize;
module1.watch(require("path"), {
  join(v) {
    pathJoin = v;
  },

  normalize(v) {
    pathNormalize = v;
  }

}, 2);
let check;
module1.watch(require("meteor/check"), {
  check(v) {
    check = v;
  }

}, 3);
module1.watch(require("./security.js"));
module1.watch(require("./client.js"));
const hasOwn = Object.prototype.hasOwnProperty;
Object.keys(dynamicImportInfo).forEach(platform => {
  const info = dynamicImportInfo[platform];

  if (info.dynamicRoot) {
    info.dynamicRoot = pathNormalize(info.dynamicRoot);
  }
});
Meteor.methods({
  __dynamicImport(tree) {
    check(tree, Object);
    this.unblock();
    const platform = this.connection ? "web.browser" : "server";
    const pathParts = [];

    function walk(node) {
      if (node && typeof node === "object") {
        Object.keys(node).forEach(name => {
          pathParts.push(name);
          node[name] = walk(node[name]);
          assert.strictEqual(pathParts.pop(), name);
        });
      } else {
        return read(pathParts, platform);
      }

      return node;
    }

    return walk(tree);
  }

});

function read(pathParts, platform) {
  const {
    dynamicRoot
  } = dynamicImportInfo[platform];
  const absPath = pathNormalize(pathJoin(dynamicRoot, pathJoin(...pathParts).replace(/:/g, "_")));

  if (!absPath.startsWith(dynamicRoot)) {
    throw new Meteor.Error("bad dynamic module path");
  }

  const cache = getCache(platform);
  return hasOwn.call(cache, absPath) ? cache[absPath] : cache[absPath] = readFileSync(absPath, "utf8");
}

const cachesByPlatform = Object.create(null);

function getCache(platform) {
  return hasOwn.call(cachesByPlatform, platform) ? cachesByPlatform[platform] : cachesByPlatform[platform] = Object.create(null);
}

process.on("message", msg => {
  // The cache for the "web.browser" platform needs to be discarded
  // whenever a client-only refresh occurs, so that new client code does
  // not receive stale module data from __dynamicImport. This code handles
  // the same message listened for by the autoupdate package.
  if (msg && msg.refresh === "client") {
    delete cachesByPlatform["web.browser"];
  }
});
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"cache.js":function(require,exports,module){

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                              //
// packages/dynamic-import/cache.js                                                                             //
//                                                                                                              //
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                //
var hasOwn = Object.prototype.hasOwnProperty;
var dbPromise;
var canUseCache = // The server doesn't benefit from dynamic module fetching, and almost
// certainly doesn't support IndexedDB.
Meteor.isClient && // Cordova bundles all modules into the monolithic initial bundle, so
// the dynamic module cache won't be necessary.
!Meteor.isCordova && // Caching can be confusing in development, and is designed to be a
// transparent optimization for production performance.
Meteor.isProduction;

function getIDB() {
  if (typeof indexedDB !== "undefined") return indexedDB;
  if (typeof webkitIndexedDB !== "undefined") return webkitIndexedDB;
  if (typeof mozIndexedDB !== "undefined") return mozIndexedDB;
  if (typeof OIndexedDB !== "undefined") return OIndexedDB;
  if (typeof msIndexedDB !== "undefined") return msIndexedDB;
}

function withDB(callback) {
  dbPromise = dbPromise || new Promise(function (resolve, reject) {
    var idb = getIDB();

    if (!idb) {
      throw new Error("IndexedDB not available");
    } // Incrementing the version number causes all existing object stores
    // to be deleted and recreates those specified by objectStoreMap.


    var request = idb.open("MeteorDynamicImportCache", 2);

    request.onupgradeneeded = function (event) {
      var db = event.target.result; // It's fine to delete existing object stores since onupgradeneeded
      // is only called when we change the DB version number, and the data
      // we're storing is disposable/reconstructible.

      Array.from(db.objectStoreNames).forEach(db.deleteObjectStore, db);
      Object.keys(objectStoreMap).forEach(function (name) {
        db.createObjectStore(name, objectStoreMap[name]);
      });
    };

    request.onerror = makeOnError(reject, "indexedDB.open");

    request.onsuccess = function (event) {
      resolve(event.target.result);
    };
  });
  return dbPromise.then(callback, function (error) {
    return callback(null);
  });
}

var objectStoreMap = {
  sourcesByVersion: {
    keyPath: "version"
  }
};

function makeOnError(reject, source) {
  return function (event) {
    reject(new Error("IndexedDB failure in " + source + " " + JSON.stringify(event.target))); // Returning true from an onerror callback function prevents an
    // InvalidStateError in Firefox during Private Browsing. Silencing
    // that error is safe because we handle the error more gracefully by
    // passing it to the Promise reject function above.
    // https://github.com/meteor/meteor/issues/8697

    return true;
  };
}

var checkCount = 0;

exports.checkMany = function (versions) {
  var ids = Object.keys(versions);
  var sourcesById = Object.create(null); // Initialize sourcesById with null values to indicate all sources are
  // missing (unless replaced with actual sources below).

  ids.forEach(function (id) {
    sourcesById[id] = null;
  });

  if (!canUseCache) {
    return Promise.resolve(sourcesById);
  }

  return withDB(function (db) {
    if (!db) {
      // We thought we could used IndexedDB, but something went wrong
      // while opening the database, so err on the side of safety.
      return sourcesById;
    }

    var txn = db.transaction(["sourcesByVersion"], "readonly");
    var sourcesByVersion = txn.objectStore("sourcesByVersion");
    ++checkCount;

    function finish() {
      --checkCount;
      return sourcesById;
    }

    return Promise.all(ids.map(function (id) {
      return new Promise(function (resolve, reject) {
        var version = versions[id];

        if (version) {
          var sourceRequest = sourcesByVersion.get(version);
          sourceRequest.onerror = makeOnError(reject, "sourcesByVersion.get");

          sourceRequest.onsuccess = function (event) {
            var result = event.target.result;

            if (result) {
              sourcesById[id] = result.source;
            }

            resolve();
          };
        } else resolve();
      });
    })).then(finish, finish);
  });
};

var pendingVersionsAndSourcesById = Object.create(null);

exports.setMany = function (versionsAndSourcesById) {
  if (canUseCache) {
    Object.assign(pendingVersionsAndSourcesById, versionsAndSourcesById); // Delay the call to flushSetMany so that it doesn't contribute to the
    // amount of time it takes to call module.dynamicImport.

    if (!flushSetMany.timer) {
      flushSetMany.timer = setTimeout(flushSetMany, 100);
    }
  }
};

function flushSetMany() {
  if (checkCount > 0) {
    // If checkMany is currently underway, postpone the flush until later,
    // since updating the cache is less important than reading from it.
    return flushSetMany.timer = setTimeout(flushSetMany, 100);
  }

  flushSetMany.timer = null;
  var versionsAndSourcesById = pendingVersionsAndSourcesById;
  pendingVersionsAndSourcesById = Object.create(null);
  return withDB(function (db) {
    if (!db) {
      // We thought we could used IndexedDB, but something went wrong
      // while opening the database, so err on the side of safety.
      return;
    }

    var setTxn = db.transaction(["sourcesByVersion"], "readwrite");
    var sourcesByVersion = setTxn.objectStore("sourcesByVersion");
    return Promise.all(Object.keys(versionsAndSourcesById).map(function (id) {
      var info = versionsAndSourcesById[id];
      return new Promise(function (resolve, reject) {
        var request = sourcesByVersion.put({
          version: info.version,
          source: info.source
        });
        request.onerror = makeOnError(reject, "sourcesByVersion.put");
        request.onsuccess = resolve;
      });
    }));
  });
}
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"client.js":function(require,exports,module){

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                              //
// packages/dynamic-import/client.js                                                                            //
//                                                                                                              //
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                //
var Module = module.constructor;

var cache = require("./cache.js"); // Call module.dynamicImport(id) to fetch a module and any/all of its
// dependencies that have not already been fetched, and evaluate them as
// soon as they arrive. This runtime API makes it very easy to implement
// ECMAScript dynamic import(...) syntax.


Module.prototype.dynamicImport = function (id) {
  var module = this;
  return module.prefetch(id).then(function () {
    return getNamespace(module, id);
  });
}; // Called by Module.prototype.prefetch if there are any missing dynamic
// modules that need to be fetched.


meteorInstall.fetch = function (ids) {
  var tree = Object.create(null);
  var versions = Object.create(null);

  var dynamicVersions = require("./dynamic-versions.js");

  var missing;
  Object.keys(ids).forEach(function (id) {
    var version = dynamicVersions.get(id);

    if (version) {
      versions[id] = version;
    } else {
      addToTree(missing = missing || Object.create(null), id, 1);
    }
  });
  return cache.checkMany(versions).then(function (sources) {
    Object.keys(sources).forEach(function (id) {
      var source = sources[id];

      if (source) {
        var info = ids[id];
        addToTree(tree, id, makeModuleFunction(id, source, info.options));
      } else {
        addToTree(missing = missing || Object.create(null), id, 1);
      }
    });
    return missing && fetchMissing(missing).then(function (results) {
      var versionsAndSourcesById = Object.create(null);
      var flatResults = flattenModuleTree(results);
      Object.keys(flatResults).forEach(function (id) {
        var source = flatResults[id];
        var info = ids[id];
        addToTree(tree, id, makeModuleFunction(id, source, info.options));
        var version = dynamicVersions.get(id);

        if (version) {
          versionsAndSourcesById[id] = {
            version: version,
            source: source
          };
        }
      });
      cache.setMany(versionsAndSourcesById);
    });
  }).then(function () {
    return tree;
  });
};

function flattenModuleTree(tree) {
  var parts = [""];
  var result = Object.create(null);

  function walk(t) {
    if (t && typeof t === "object") {
      Object.keys(t).forEach(function (key) {
        parts.push(key);
        walk(t[key]);
        parts.pop();
      });
    } else if (typeof t === "string") {
      result[parts.join("/")] = t;
    }
  }

  walk(tree);
  return result;
}

function makeModuleFunction(id, source, options) {
  // By calling (options && options.eval || eval) in a wrapper function,
  // we delay the cost of parsing and evaluating the module code until the
  // module is first imported.
  return function () {
    // If an options.eval function was provided in the second argument to
    // meteorInstall when this bundle was first installed, use that
    // function to parse and evaluate the dynamic module code in the scope
    // of the package. Otherwise fall back to indirect (global) eval.
    return (options && options.eval || eval)( // Wrap the function(require,exports,module){...} expression in
    // parentheses to force it to be parsed as an expression.
    "(" + source + ")\n//# sourceURL=" + id).apply(this, arguments);
  };
}

function fetchMissing(missingTree) {
  // Update lastFetchMissingPromise immediately, without waiting for
  // the results to be delivered.
  return new Promise(function (resolve, reject) {
    Meteor.call("__dynamicImport", missingTree, function (error, resultsTree) {
      error ? reject(error) : resolve(resultsTree);
    });
  });
}

function addToTree(tree, id, value) {
  var parts = id.split("/");
  var lastIndex = parts.length - 1;
  parts.forEach(function (part, i) {
    if (part) {
      tree = tree[part] = tree[part] || (i < lastIndex ? Object.create(null) : value);
    }
  });
}

function getNamespace(module, id) {
  var namespace;
  module.watch(module.require(id), {
    "*": function (ns) {
      namespace = ns;
    }
  }); // This helps with Babel interop, since we're not just returning the
  // module.exports object.

  Object.defineProperty(namespace, "__esModule", {
    value: true,
    enumerable: false
  });
  return namespace;
}
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"dynamic-versions.js":function(require,exports){

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                              //
// packages/dynamic-import/dynamic-versions.js                                                                  //
//                                                                                                              //
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                //
// This magic double-underscored identifier gets replaced in
// tools/isobuild/bundler.js with a tree of hashes of all dynamic
// modules, for use in client.js and cache.js.
var versions = {};

exports.get = function (id) {
  var tree = versions;
  var version = null;
  id.split("/").some(function (part) {
    if (part) {
      // If the tree contains identifiers for Meteor packages with colons
      // in their names, the colons should not have been replaced by
      // underscores, but there's a bug that results in that behavior, so
      // for now it seems safest to be tolerant of underscores here.
      // https://github.com/meteor/meteor/pull/9103
      tree = tree[part] || tree[part.replace(":", "_")];
    }

    if (!tree) {
      // Terminate the search without reassigning version.
      return true;
    }

    if (typeof tree === "string") {
      version = tree;
      return true;
    }
  });
  return version;
};
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"security.js":function(require,exports,module){

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                              //
// packages/dynamic-import/security.js                                                                          //
//                                                                                                              //
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                //
const bpc = Package["browser-policy-content"];
const BP = bpc && bpc.BrowserPolicy;
const BPc = BP && BP.content;

if (BPc) {
  // The ability to evaluate new code is essential for loading dynamic
  // modules. Without eval, we would be forced to load modules using
  // <script src=...> tags, and then there would be no way to save those
  // modules to a local cache (or load them from the cache) without the
  // unique response caching abilities of service workers, which are not
  // available in all browsers, and cannot be polyfilled in a way that
  // satisfies Content Security Policy eval restrictions. Moreover, eval
  // allows us to evaluate dynamic module code in the original package
  // scope, which would never be possible using <script> tags. If you're
  // deploying an app in an environment that demands a Content Security
  // Policy that forbids eval, your only option is to bundle all dynamic
  // modules in the initial bundle. Fortunately, that works perfectly
  // well; you just won't get the performance benefits of dynamic module
  // fetching.
  BPc.allowEval();
}
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////

}}}}},{
  "extensions": [
    ".js",
    ".json"
  ]
});
var exports = require("./node_modules/meteor/dynamic-import/server.js");

/* Exports */
if (typeof Package === 'undefined') Package = {};
Package['dynamic-import'] = exports;

})();

//# sourceURL=meteor://💻app/packages/dynamic-import.js
//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvZHluYW1pYy1pbXBvcnQvc2VydmVyLmpzIiwibWV0ZW9yOi8v8J+Su2FwcC9wYWNrYWdlcy9keW5hbWljLWltcG9ydC9jYWNoZS5qcyIsIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvZHluYW1pYy1pbXBvcnQvY2xpZW50LmpzIiwibWV0ZW9yOi8v8J+Su2FwcC9wYWNrYWdlcy9keW5hbWljLWltcG9ydC9keW5hbWljLXZlcnNpb25zLmpzIiwibWV0ZW9yOi8v8J+Su2FwcC9wYWNrYWdlcy9keW5hbWljLWltcG9ydC9zZWN1cml0eS5qcyJdLCJuYW1lcyI6WyJtb2R1bGUxIiwibW9kdWxlIiwiYXNzZXJ0Iiwid2F0Y2giLCJyZXF1aXJlIiwiZGVmYXVsdCIsInYiLCJyZWFkRmlsZVN5bmMiLCJwYXRoSm9pbiIsInBhdGhOb3JtYWxpemUiLCJqb2luIiwibm9ybWFsaXplIiwiY2hlY2siLCJoYXNPd24iLCJPYmplY3QiLCJwcm90b3R5cGUiLCJoYXNPd25Qcm9wZXJ0eSIsImtleXMiLCJkeW5hbWljSW1wb3J0SW5mbyIsImZvckVhY2giLCJwbGF0Zm9ybSIsImluZm8iLCJkeW5hbWljUm9vdCIsIk1ldGVvciIsIm1ldGhvZHMiLCJfX2R5bmFtaWNJbXBvcnQiLCJ0cmVlIiwidW5ibG9jayIsImNvbm5lY3Rpb24iLCJwYXRoUGFydHMiLCJ3YWxrIiwibm9kZSIsIm5hbWUiLCJwdXNoIiwic3RyaWN0RXF1YWwiLCJwb3AiLCJyZWFkIiwiYWJzUGF0aCIsInJlcGxhY2UiLCJzdGFydHNXaXRoIiwiRXJyb3IiLCJjYWNoZSIsImdldENhY2hlIiwiY2FsbCIsImNhY2hlc0J5UGxhdGZvcm0iLCJjcmVhdGUiLCJwcm9jZXNzIiwib24iLCJtc2ciLCJyZWZyZXNoIiwiZGJQcm9taXNlIiwiY2FuVXNlQ2FjaGUiLCJpc0NsaWVudCIsImlzQ29yZG92YSIsImlzUHJvZHVjdGlvbiIsImdldElEQiIsImluZGV4ZWREQiIsIndlYmtpdEluZGV4ZWREQiIsIm1vekluZGV4ZWREQiIsIk9JbmRleGVkREIiLCJtc0luZGV4ZWREQiIsIndpdGhEQiIsImNhbGxiYWNrIiwiUHJvbWlzZSIsInJlc29sdmUiLCJyZWplY3QiLCJpZGIiLCJyZXF1ZXN0Iiwib3BlbiIsIm9udXBncmFkZW5lZWRlZCIsImV2ZW50IiwiZGIiLCJ0YXJnZXQiLCJyZXN1bHQiLCJBcnJheSIsImZyb20iLCJvYmplY3RTdG9yZU5hbWVzIiwiZGVsZXRlT2JqZWN0U3RvcmUiLCJvYmplY3RTdG9yZU1hcCIsImNyZWF0ZU9iamVjdFN0b3JlIiwib25lcnJvciIsIm1ha2VPbkVycm9yIiwib25zdWNjZXNzIiwidGhlbiIsImVycm9yIiwic291cmNlc0J5VmVyc2lvbiIsImtleVBhdGgiLCJzb3VyY2UiLCJKU09OIiwic3RyaW5naWZ5IiwiY2hlY2tDb3VudCIsImV4cG9ydHMiLCJjaGVja01hbnkiLCJ2ZXJzaW9ucyIsImlkcyIsInNvdXJjZXNCeUlkIiwiaWQiLCJ0eG4iLCJ0cmFuc2FjdGlvbiIsIm9iamVjdFN0b3JlIiwiZmluaXNoIiwiYWxsIiwibWFwIiwidmVyc2lvbiIsInNvdXJjZVJlcXVlc3QiLCJnZXQiLCJwZW5kaW5nVmVyc2lvbnNBbmRTb3VyY2VzQnlJZCIsInNldE1hbnkiLCJ2ZXJzaW9uc0FuZFNvdXJjZXNCeUlkIiwiYXNzaWduIiwiZmx1c2hTZXRNYW55IiwidGltZXIiLCJzZXRUaW1lb3V0Iiwic2V0VHhuIiwicHV0IiwiTW9kdWxlIiwiY29uc3RydWN0b3IiLCJkeW5hbWljSW1wb3J0IiwicHJlZmV0Y2giLCJnZXROYW1lc3BhY2UiLCJtZXRlb3JJbnN0YWxsIiwiZmV0Y2giLCJkeW5hbWljVmVyc2lvbnMiLCJtaXNzaW5nIiwiYWRkVG9UcmVlIiwic291cmNlcyIsIm1ha2VNb2R1bGVGdW5jdGlvbiIsIm9wdGlvbnMiLCJmZXRjaE1pc3NpbmciLCJyZXN1bHRzIiwiZmxhdFJlc3VsdHMiLCJmbGF0dGVuTW9kdWxlVHJlZSIsInBhcnRzIiwidCIsImtleSIsImV2YWwiLCJhcHBseSIsImFyZ3VtZW50cyIsIm1pc3NpbmdUcmVlIiwicmVzdWx0c1RyZWUiLCJ2YWx1ZSIsInNwbGl0IiwibGFzdEluZGV4IiwibGVuZ3RoIiwicGFydCIsImkiLCJuYW1lc3BhY2UiLCJucyIsImRlZmluZVByb3BlcnR5IiwiZW51bWVyYWJsZSIsIl9fRFlOQU1JQ19WRVJTSU9OU19fIiwic29tZSIsImJwYyIsIlBhY2thZ2UiLCJCUCIsIkJyb3dzZXJQb2xpY3kiLCJCUGMiLCJjb250ZW50IiwiYWxsb3dFdmFsIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLE1BQU1BLFVBQVFDLE1BQWQ7QUFBcUIsSUFBSUMsTUFBSjtBQUFXRixRQUFRRyxLQUFSLENBQWNDLFFBQVEsUUFBUixDQUFkLEVBQWdDO0FBQUNDLFVBQVFDLENBQVIsRUFBVTtBQUFDSixhQUFPSSxDQUFQO0FBQVM7O0FBQXJCLENBQWhDLEVBQXVELENBQXZEO0FBQTBELElBQUlDLFlBQUo7QUFBaUJQLFFBQVFHLEtBQVIsQ0FBY0MsUUFBUSxJQUFSLENBQWQsRUFBNEI7QUFBQ0csZUFBYUQsQ0FBYixFQUFlO0FBQUNDLG1CQUFhRCxDQUFiO0FBQWU7O0FBQWhDLENBQTVCLEVBQThELENBQTlEO0FBQWlFLElBQUlFLFFBQUosRUFBYUMsYUFBYjtBQUEyQlQsUUFBUUcsS0FBUixDQUFjQyxRQUFRLE1BQVIsQ0FBZCxFQUE4QjtBQUFDTSxPQUFLSixDQUFMLEVBQU87QUFBQ0UsZUFBU0YsQ0FBVDtBQUFXLEdBQXBCOztBQUFxQkssWUFBVUwsQ0FBVixFQUFZO0FBQUNHLG9CQUFjSCxDQUFkO0FBQWdCOztBQUFsRCxDQUE5QixFQUFrRixDQUFsRjtBQUFxRixJQUFJTSxLQUFKO0FBQVVaLFFBQVFHLEtBQVIsQ0FBY0MsUUFBUSxjQUFSLENBQWQsRUFBc0M7QUFBQ1EsUUFBTU4sQ0FBTixFQUFRO0FBQUNNLFlBQU1OLENBQU47QUFBUTs7QUFBbEIsQ0FBdEMsRUFBMEQsQ0FB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QkQsQzs7Ozs7Ozs7Ozs7QUNMQSxNQUFNaUQsTUFBTUMsUUFBUSx3QkFBUixDQUFaO0FBQ0EsTUFBTUMsS0FBS0YsT0FBT0EsSUFBSUcsYUFBdEI7QUFDQSxNQUFNQyxNQUFNRixNQUFNQSxHQUFHRyxPQUFyQjs7QUFDQSxJQUFJRCxHQUFKLEVBQVM7QUFDUDtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0FBLE1BQUlFLFNBQUo7QUFDRCxDIiwiZmlsZSI6Ii9wYWNrYWdlcy9keW5hbWljLWltcG9ydC5qcyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBhc3NlcnQgZnJvbSBcImFzc2VydFwiO1xuaW1wb3J0IHsgcmVhZEZpbGVTeW5jIH0gZnJvbSBcImZzXCI7XG5pbXBvcnQge1xuICBqb2luIGFzIHBhdGhKb2luLFxuICBub3JtYWxpemUgYXMgcGF0aE5vcm1hbGl6ZSxcbn0gZnJvbSBcInBhdGhcIjtcblxuaW1wb3J0IHsgY2hlY2sgfSBmcm9tIFwibWV0ZW9yL2NoZWNrXCI7XG5cbmltcG9ydCBcIi4vc2VjdXJpdHkuanNcIjtcbmltcG9ydCBcIi4vY2xpZW50LmpzXCI7XG5cbmNvbnN0IGhhc093biA9IE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHk7XG5cbk9iamVjdC5rZXlzKGR5bmFtaWNJbXBvcnRJbmZvKS5mb3JFYWNoKHBsYXRmb3JtID0+IHtcbiAgY29uc3QgaW5mbyA9IGR5bmFtaWNJbXBvcnRJbmZvW3BsYXRmb3JtXTtcbiAgaWYgKGluZm8uZHluYW1pY1Jvb3QpIHtcbiAgICBpbmZvLmR5bmFtaWNSb290ID0gcGF0aE5vcm1hbGl6ZShpbmZvLmR5bmFtaWNSb290KTtcbiAgfVxufSk7XG5cbk1ldGVvci5tZXRob2RzKHtcbiAgX19keW5hbWljSW1wb3J0KHRyZWUpIHtcbiAgICBjaGVjayh0cmVlLCBPYmplY3QpO1xuICAgIHRoaXMudW5ibG9jaygpO1xuXG4gICAgY29uc3QgcGxhdGZvcm0gPSB0aGlzLmNvbm5lY3Rpb24gPyBcIndlYi5icm93c2VyXCIgOiBcInNlcnZlclwiO1xuICAgIGNvbnN0IHBhdGhQYXJ0cyA9IFtdO1xuXG4gICAgZnVuY3Rpb24gd2Fsayhub2RlKSB7XG4gICAgICBpZiAobm9kZSAmJiB0eXBlb2Ygbm9kZSA9PT0gXCJvYmplY3RcIikge1xuICAgICAgICBPYmplY3Qua2V5cyhub2RlKS5mb3JFYWNoKG5hbWUgPT4ge1xuICAgICAgICAgIHBhdGhQYXJ0cy5wdXNoKG5hbWUpO1xuICAgICAgICAgIG5vZGVbbmFtZV0gPSB3YWxrKG5vZGVbbmFtZV0pO1xuICAgICAgICAgIGFzc2VydC5zdHJpY3RFcXVhbChwYXRoUGFydHMucG9wKCksIG5hbWUpO1xuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiByZWFkKHBhdGhQYXJ0cywgcGxhdGZvcm0pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG5vZGU7XG4gICAgfVxuXG4gICAgcmV0dXJuIHdhbGsodHJlZSk7XG4gIH1cbn0pO1xuXG5mdW5jdGlvbiByZWFkKHBhdGhQYXJ0cywgcGxhdGZvcm0pIHtcbiAgY29uc3QgeyBkeW5hbWljUm9vdCB9ID0gZHluYW1pY0ltcG9ydEluZm9bcGxhdGZvcm1dO1xuICBjb25zdCBhYnNQYXRoID0gcGF0aE5vcm1hbGl6ZShwYXRoSm9pbihcbiAgICBkeW5hbWljUm9vdCxcbiAgICBwYXRoSm9pbiguLi5wYXRoUGFydHMpLnJlcGxhY2UoLzovZywgXCJfXCIpXG4gICkpO1xuXG4gIGlmICghIGFic1BhdGguc3RhcnRzV2l0aChkeW5hbWljUm9vdCkpIHtcbiAgICB0aHJvdyBuZXcgTWV0ZW9yLkVycm9yKFwiYmFkIGR5bmFtaWMgbW9kdWxlIHBhdGhcIik7XG4gIH1cblxuICBjb25zdCBjYWNoZSA9IGdldENhY2hlKHBsYXRmb3JtKTtcbiAgcmV0dXJuIGhhc093bi5jYWxsKGNhY2hlLCBhYnNQYXRoKVxuICAgID8gY2FjaGVbYWJzUGF0aF1cbiAgICA6IGNhY2hlW2Fic1BhdGhdID0gcmVhZEZpbGVTeW5jKGFic1BhdGgsIFwidXRmOFwiKTtcbn1cblxuY29uc3QgY2FjaGVzQnlQbGF0Zm9ybSA9IE9iamVjdC5jcmVhdGUobnVsbCk7XG5mdW5jdGlvbiBnZXRDYWNoZShwbGF0Zm9ybSkge1xuICByZXR1cm4gaGFzT3duLmNhbGwoY2FjaGVzQnlQbGF0Zm9ybSwgcGxhdGZvcm0pXG4gICAgPyBjYWNoZXNCeVBsYXRmb3JtW3BsYXRmb3JtXVxuICAgIDogY2FjaGVzQnlQbGF0Zm9ybVtwbGF0Zm9ybV0gPSBPYmplY3QuY3JlYXRlKG51bGwpO1xufVxuXG5wcm9jZXNzLm9uKFwibWVzc2FnZVwiLCBtc2cgPT4ge1xuICAvLyBUaGUgY2FjaGUgZm9yIHRoZSBcIndlYi5icm93c2VyXCIgcGxhdGZvcm0gbmVlZHMgdG8gYmUgZGlzY2FyZGVkXG4gIC8vIHdoZW5ldmVyIGEgY2xpZW50LW9ubHkgcmVmcmVzaCBvY2N1cnMsIHNvIHRoYXQgbmV3IGNsaWVudCBjb2RlIGRvZXNcbiAgLy8gbm90IHJlY2VpdmUgc3RhbGUgbW9kdWxlIGRhdGEgZnJvbSBfX2R5bmFtaWNJbXBvcnQuIFRoaXMgY29kZSBoYW5kbGVzXG4gIC8vIHRoZSBzYW1lIG1lc3NhZ2UgbGlzdGVuZWQgZm9yIGJ5IHRoZSBhdXRvdXBkYXRlIHBhY2thZ2UuXG4gIGlmIChtc2cgJiYgbXNnLnJlZnJlc2ggPT09IFwiY2xpZW50XCIpIHtcbiAgICBkZWxldGUgY2FjaGVzQnlQbGF0Zm9ybVtcIndlYi5icm93c2VyXCJdO1xuICB9XG59KTtcbiIsInZhciBoYXNPd24gPSBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5O1xudmFyIGRiUHJvbWlzZTtcblxudmFyIGNhblVzZUNhY2hlID1cbiAgLy8gVGhlIHNlcnZlciBkb2Vzbid0IGJlbmVmaXQgZnJvbSBkeW5hbWljIG1vZHVsZSBmZXRjaGluZywgYW5kIGFsbW9zdFxuICAvLyBjZXJ0YWlubHkgZG9lc24ndCBzdXBwb3J0IEluZGV4ZWREQi5cbiAgTWV0ZW9yLmlzQ2xpZW50ICYmXG4gIC8vIENvcmRvdmEgYnVuZGxlcyBhbGwgbW9kdWxlcyBpbnRvIHRoZSBtb25vbGl0aGljIGluaXRpYWwgYnVuZGxlLCBzb1xuICAvLyB0aGUgZHluYW1pYyBtb2R1bGUgY2FjaGUgd29uJ3QgYmUgbmVjZXNzYXJ5LlxuICAhIE1ldGVvci5pc0NvcmRvdmEgJiZcbiAgLy8gQ2FjaGluZyBjYW4gYmUgY29uZnVzaW5nIGluIGRldmVsb3BtZW50LCBhbmQgaXMgZGVzaWduZWQgdG8gYmUgYVxuICAvLyB0cmFuc3BhcmVudCBvcHRpbWl6YXRpb24gZm9yIHByb2R1Y3Rpb24gcGVyZm9ybWFuY2UuXG4gIE1ldGVvci5pc1Byb2R1Y3Rpb247XG5cbmZ1bmN0aW9uIGdldElEQigpIHtcbiAgaWYgKHR5cGVvZiBpbmRleGVkREIgIT09IFwidW5kZWZpbmVkXCIpIHJldHVybiBpbmRleGVkREI7XG4gIGlmICh0eXBlb2Ygd2Via2l0SW5kZXhlZERCICE9PSBcInVuZGVmaW5lZFwiKSByZXR1cm4gd2Via2l0SW5kZXhlZERCO1xuICBpZiAodHlwZW9mIG1vekluZGV4ZWREQiAhPT0gXCJ1bmRlZmluZWRcIikgcmV0dXJuIG1vekluZGV4ZWREQjtcbiAgaWYgKHR5cGVvZiBPSW5kZXhlZERCICE9PSBcInVuZGVmaW5lZFwiKSByZXR1cm4gT0luZGV4ZWREQjtcbiAgaWYgKHR5cGVvZiBtc0luZGV4ZWREQiAhPT0gXCJ1bmRlZmluZWRcIikgcmV0dXJuIG1zSW5kZXhlZERCO1xufVxuXG5mdW5jdGlvbiB3aXRoREIoY2FsbGJhY2spIHtcbiAgZGJQcm9taXNlID0gZGJQcm9taXNlIHx8IG5ldyBQcm9taXNlKGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHtcbiAgICB2YXIgaWRiID0gZ2V0SURCKCk7XG4gICAgaWYgKCEgaWRiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJJbmRleGVkREIgbm90IGF2YWlsYWJsZVwiKTtcbiAgICB9XG5cbiAgICAvLyBJbmNyZW1lbnRpbmcgdGhlIHZlcnNpb24gbnVtYmVyIGNhdXNlcyBhbGwgZXhpc3Rpbmcgb2JqZWN0IHN0b3Jlc1xuICAgIC8vIHRvIGJlIGRlbGV0ZWQgYW5kIHJlY3JlYXRlcyB0aG9zZSBzcGVjaWZpZWQgYnkgb2JqZWN0U3RvcmVNYXAuXG4gICAgdmFyIHJlcXVlc3QgPSBpZGIub3BlbihcIk1ldGVvckR5bmFtaWNJbXBvcnRDYWNoZVwiLCAyKTtcblxuICAgIHJlcXVlc3Qub251cGdyYWRlbmVlZGVkID0gZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICB2YXIgZGIgPSBldmVudC50YXJnZXQucmVzdWx0O1xuXG4gICAgICAvLyBJdCdzIGZpbmUgdG8gZGVsZXRlIGV4aXN0aW5nIG9iamVjdCBzdG9yZXMgc2luY2Ugb251cGdyYWRlbmVlZGVkXG4gICAgICAvLyBpcyBvbmx5IGNhbGxlZCB3aGVuIHdlIGNoYW5nZSB0aGUgREIgdmVyc2lvbiBudW1iZXIsIGFuZCB0aGUgZGF0YVxuICAgICAgLy8gd2UncmUgc3RvcmluZyBpcyBkaXNwb3NhYmxlL3JlY29uc3RydWN0aWJsZS5cbiAgICAgIEFycmF5LmZyb20oZGIub2JqZWN0U3RvcmVOYW1lcykuZm9yRWFjaChkYi5kZWxldGVPYmplY3RTdG9yZSwgZGIpO1xuXG4gICAgICBPYmplY3Qua2V5cyhvYmplY3RTdG9yZU1hcCkuZm9yRWFjaChmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICBkYi5jcmVhdGVPYmplY3RTdG9yZShuYW1lLCBvYmplY3RTdG9yZU1hcFtuYW1lXSk7XG4gICAgICB9KTtcbiAgICB9O1xuXG4gICAgcmVxdWVzdC5vbmVycm9yID0gbWFrZU9uRXJyb3IocmVqZWN0LCBcImluZGV4ZWREQi5vcGVuXCIpO1xuICAgIHJlcXVlc3Qub25zdWNjZXNzID0gZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICByZXNvbHZlKGV2ZW50LnRhcmdldC5yZXN1bHQpO1xuICAgIH07XG4gIH0pO1xuXG4gIHJldHVybiBkYlByb21pc2UudGhlbihjYWxsYmFjaywgZnVuY3Rpb24gKGVycm9yKSB7XG4gICAgcmV0dXJuIGNhbGxiYWNrKG51bGwpO1xuICB9KTtcbn1cblxudmFyIG9iamVjdFN0b3JlTWFwID0ge1xuICBzb3VyY2VzQnlWZXJzaW9uOiB7IGtleVBhdGg6IFwidmVyc2lvblwiIH1cbn07XG5cbmZ1bmN0aW9uIG1ha2VPbkVycm9yKHJlamVjdCwgc291cmNlKSB7XG4gIHJldHVybiBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICByZWplY3QobmV3IEVycm9yKFxuICAgICAgXCJJbmRleGVkREIgZmFpbHVyZSBpbiBcIiArIHNvdXJjZSArIFwiIFwiICtcbiAgICAgICAgSlNPTi5zdHJpbmdpZnkoZXZlbnQudGFyZ2V0KVxuICAgICkpO1xuXG4gICAgLy8gUmV0dXJuaW5nIHRydWUgZnJvbSBhbiBvbmVycm9yIGNhbGxiYWNrIGZ1bmN0aW9uIHByZXZlbnRzIGFuXG4gICAgLy8gSW52YWxpZFN0YXRlRXJyb3IgaW4gRmlyZWZveCBkdXJpbmcgUHJpdmF0ZSBCcm93c2luZy4gU2lsZW5jaW5nXG4gICAgLy8gdGhhdCBlcnJvciBpcyBzYWZlIGJlY2F1c2Ugd2UgaGFuZGxlIHRoZSBlcnJvciBtb3JlIGdyYWNlZnVsbHkgYnlcbiAgICAvLyBwYXNzaW5nIGl0IHRvIHRoZSBQcm9taXNlIHJlamVjdCBmdW5jdGlvbiBhYm92ZS5cbiAgICAvLyBodHRwczovL2dpdGh1Yi5jb20vbWV0ZW9yL21ldGVvci9pc3N1ZXMvODY5N1xuICAgIHJldHVybiB0cnVlO1xuICB9O1xufVxuXG52YXIgY2hlY2tDb3VudCA9IDA7XG5cbmV4cG9ydHMuY2hlY2tNYW55ID0gZnVuY3Rpb24gKHZlcnNpb25zKSB7XG4gIHZhciBpZHMgPSBPYmplY3Qua2V5cyh2ZXJzaW9ucyk7XG4gIHZhciBzb3VyY2VzQnlJZCA9IE9iamVjdC5jcmVhdGUobnVsbCk7XG5cbiAgLy8gSW5pdGlhbGl6ZSBzb3VyY2VzQnlJZCB3aXRoIG51bGwgdmFsdWVzIHRvIGluZGljYXRlIGFsbCBzb3VyY2VzIGFyZVxuICAvLyBtaXNzaW5nICh1bmxlc3MgcmVwbGFjZWQgd2l0aCBhY3R1YWwgc291cmNlcyBiZWxvdykuXG4gIGlkcy5mb3JFYWNoKGZ1bmN0aW9uIChpZCkge1xuICAgIHNvdXJjZXNCeUlkW2lkXSA9IG51bGw7XG4gIH0pO1xuXG4gIGlmICghIGNhblVzZUNhY2hlKSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShzb3VyY2VzQnlJZCk7XG4gIH1cblxuICByZXR1cm4gd2l0aERCKGZ1bmN0aW9uIChkYikge1xuICAgIGlmICghIGRiKSB7XG4gICAgICAvLyBXZSB0aG91Z2h0IHdlIGNvdWxkIHVzZWQgSW5kZXhlZERCLCBidXQgc29tZXRoaW5nIHdlbnQgd3JvbmdcbiAgICAgIC8vIHdoaWxlIG9wZW5pbmcgdGhlIGRhdGFiYXNlLCBzbyBlcnIgb24gdGhlIHNpZGUgb2Ygc2FmZXR5LlxuICAgICAgcmV0dXJuIHNvdXJjZXNCeUlkO1xuICAgIH1cblxuICAgIHZhciB0eG4gPSBkYi50cmFuc2FjdGlvbihbXG4gICAgICBcInNvdXJjZXNCeVZlcnNpb25cIlxuICAgIF0sIFwicmVhZG9ubHlcIik7XG5cbiAgICB2YXIgc291cmNlc0J5VmVyc2lvbiA9IHR4bi5vYmplY3RTdG9yZShcInNvdXJjZXNCeVZlcnNpb25cIik7XG5cbiAgICArK2NoZWNrQ291bnQ7XG5cbiAgICBmdW5jdGlvbiBmaW5pc2goKSB7XG4gICAgICAtLWNoZWNrQ291bnQ7XG4gICAgICByZXR1cm4gc291cmNlc0J5SWQ7XG4gICAgfVxuXG4gICAgcmV0dXJuIFByb21pc2UuYWxsKGlkcy5tYXAoZnVuY3Rpb24gKGlkKSB7XG4gICAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24gKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgICB2YXIgdmVyc2lvbiA9IHZlcnNpb25zW2lkXTtcbiAgICAgICAgaWYgKHZlcnNpb24pIHtcbiAgICAgICAgICB2YXIgc291cmNlUmVxdWVzdCA9IHNvdXJjZXNCeVZlcnNpb24uZ2V0KHZlcnNpb24pO1xuICAgICAgICAgIHNvdXJjZVJlcXVlc3Qub25lcnJvciA9IG1ha2VPbkVycm9yKHJlamVjdCwgXCJzb3VyY2VzQnlWZXJzaW9uLmdldFwiKTtcbiAgICAgICAgICBzb3VyY2VSZXF1ZXN0Lm9uc3VjY2VzcyA9IGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAgICAgdmFyIHJlc3VsdCA9IGV2ZW50LnRhcmdldC5yZXN1bHQ7XG4gICAgICAgICAgICBpZiAocmVzdWx0KSB7XG4gICAgICAgICAgICAgIHNvdXJjZXNCeUlkW2lkXSA9IHJlc3VsdC5zb3VyY2U7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXNvbHZlKCk7XG4gICAgICAgICAgfTtcbiAgICAgICAgfSBlbHNlIHJlc29sdmUoKTtcbiAgICAgIH0pO1xuICAgIH0pKS50aGVuKGZpbmlzaCwgZmluaXNoKTtcbiAgfSk7XG59O1xuXG52YXIgcGVuZGluZ1ZlcnNpb25zQW5kU291cmNlc0J5SWQgPSBPYmplY3QuY3JlYXRlKG51bGwpO1xuXG5leHBvcnRzLnNldE1hbnkgPSBmdW5jdGlvbiAodmVyc2lvbnNBbmRTb3VyY2VzQnlJZCkge1xuICBpZiAoY2FuVXNlQ2FjaGUpIHtcbiAgICBPYmplY3QuYXNzaWduKFxuICAgICAgcGVuZGluZ1ZlcnNpb25zQW5kU291cmNlc0J5SWQsXG4gICAgICB2ZXJzaW9uc0FuZFNvdXJjZXNCeUlkXG4gICAgKTtcblxuICAgIC8vIERlbGF5IHRoZSBjYWxsIHRvIGZsdXNoU2V0TWFueSBzbyB0aGF0IGl0IGRvZXNuJ3QgY29udHJpYnV0ZSB0byB0aGVcbiAgICAvLyBhbW91bnQgb2YgdGltZSBpdCB0YWtlcyB0byBjYWxsIG1vZHVsZS5keW5hbWljSW1wb3J0LlxuICAgIGlmICghIGZsdXNoU2V0TWFueS50aW1lcikge1xuICAgICAgZmx1c2hTZXRNYW55LnRpbWVyID0gc2V0VGltZW91dChmbHVzaFNldE1hbnksIDEwMCk7XG4gICAgfVxuICB9XG59O1xuXG5mdW5jdGlvbiBmbHVzaFNldE1hbnkoKSB7XG4gIGlmIChjaGVja0NvdW50ID4gMCkge1xuICAgIC8vIElmIGNoZWNrTWFueSBpcyBjdXJyZW50bHkgdW5kZXJ3YXksIHBvc3Rwb25lIHRoZSBmbHVzaCB1bnRpbCBsYXRlcixcbiAgICAvLyBzaW5jZSB1cGRhdGluZyB0aGUgY2FjaGUgaXMgbGVzcyBpbXBvcnRhbnQgdGhhbiByZWFkaW5nIGZyb20gaXQuXG4gICAgcmV0dXJuIGZsdXNoU2V0TWFueS50aW1lciA9IHNldFRpbWVvdXQoZmx1c2hTZXRNYW55LCAxMDApO1xuICB9XG5cbiAgZmx1c2hTZXRNYW55LnRpbWVyID0gbnVsbDtcblxuICB2YXIgdmVyc2lvbnNBbmRTb3VyY2VzQnlJZCA9IHBlbmRpbmdWZXJzaW9uc0FuZFNvdXJjZXNCeUlkO1xuICBwZW5kaW5nVmVyc2lvbnNBbmRTb3VyY2VzQnlJZCA9IE9iamVjdC5jcmVhdGUobnVsbCk7XG5cbiAgcmV0dXJuIHdpdGhEQihmdW5jdGlvbiAoZGIpIHtcbiAgICBpZiAoISBkYikge1xuICAgICAgLy8gV2UgdGhvdWdodCB3ZSBjb3VsZCB1c2VkIEluZGV4ZWREQiwgYnV0IHNvbWV0aGluZyB3ZW50IHdyb25nXG4gICAgICAvLyB3aGlsZSBvcGVuaW5nIHRoZSBkYXRhYmFzZSwgc28gZXJyIG9uIHRoZSBzaWRlIG9mIHNhZmV0eS5cbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgc2V0VHhuID0gZGIudHJhbnNhY3Rpb24oW1xuICAgICAgXCJzb3VyY2VzQnlWZXJzaW9uXCJcbiAgICBdLCBcInJlYWR3cml0ZVwiKTtcblxuICAgIHZhciBzb3VyY2VzQnlWZXJzaW9uID0gc2V0VHhuLm9iamVjdFN0b3JlKFwic291cmNlc0J5VmVyc2lvblwiKTtcblxuICAgIHJldHVybiBQcm9taXNlLmFsbChcbiAgICAgIE9iamVjdC5rZXlzKHZlcnNpb25zQW5kU291cmNlc0J5SWQpLm1hcChmdW5jdGlvbiAoaWQpIHtcbiAgICAgICAgdmFyIGluZm8gPSB2ZXJzaW9uc0FuZFNvdXJjZXNCeUlkW2lkXTtcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHtcbiAgICAgICAgICB2YXIgcmVxdWVzdCA9IHNvdXJjZXNCeVZlcnNpb24ucHV0KHtcbiAgICAgICAgICAgIHZlcnNpb246IGluZm8udmVyc2lvbixcbiAgICAgICAgICAgIHNvdXJjZTogaW5mby5zb3VyY2VcbiAgICAgICAgICB9KTtcbiAgICAgICAgICByZXF1ZXN0Lm9uZXJyb3IgPSBtYWtlT25FcnJvcihyZWplY3QsIFwic291cmNlc0J5VmVyc2lvbi5wdXRcIik7XG4gICAgICAgICAgcmVxdWVzdC5vbnN1Y2Nlc3MgPSByZXNvbHZlO1xuICAgICAgICB9KTtcbiAgICAgIH0pXG4gICAgKTtcbiAgfSk7XG59XG4iLCJ2YXIgTW9kdWxlID0gbW9kdWxlLmNvbnN0cnVjdG9yO1xudmFyIGNhY2hlID0gcmVxdWlyZShcIi4vY2FjaGUuanNcIik7XG5cbi8vIENhbGwgbW9kdWxlLmR5bmFtaWNJbXBvcnQoaWQpIHRvIGZldGNoIGEgbW9kdWxlIGFuZCBhbnkvYWxsIG9mIGl0c1xuLy8gZGVwZW5kZW5jaWVzIHRoYXQgaGF2ZSBub3QgYWxyZWFkeSBiZWVuIGZldGNoZWQsIGFuZCBldmFsdWF0ZSB0aGVtIGFzXG4vLyBzb29uIGFzIHRoZXkgYXJyaXZlLiBUaGlzIHJ1bnRpbWUgQVBJIG1ha2VzIGl0IHZlcnkgZWFzeSB0byBpbXBsZW1lbnRcbi8vIEVDTUFTY3JpcHQgZHluYW1pYyBpbXBvcnQoLi4uKSBzeW50YXguXG5Nb2R1bGUucHJvdG90eXBlLmR5bmFtaWNJbXBvcnQgPSBmdW5jdGlvbiAoaWQpIHtcbiAgdmFyIG1vZHVsZSA9IHRoaXM7XG4gIHJldHVybiBtb2R1bGUucHJlZmV0Y2goaWQpLnRoZW4oZnVuY3Rpb24gKCkge1xuICAgIHJldHVybiBnZXROYW1lc3BhY2UobW9kdWxlLCBpZCk7XG4gIH0pO1xufTtcblxuLy8gQ2FsbGVkIGJ5IE1vZHVsZS5wcm90b3R5cGUucHJlZmV0Y2ggaWYgdGhlcmUgYXJlIGFueSBtaXNzaW5nIGR5bmFtaWNcbi8vIG1vZHVsZXMgdGhhdCBuZWVkIHRvIGJlIGZldGNoZWQuXG5tZXRlb3JJbnN0YWxsLmZldGNoID0gZnVuY3Rpb24gKGlkcykge1xuICB2YXIgdHJlZSA9IE9iamVjdC5jcmVhdGUobnVsbCk7XG4gIHZhciB2ZXJzaW9ucyA9IE9iamVjdC5jcmVhdGUobnVsbCk7XG4gIHZhciBkeW5hbWljVmVyc2lvbnMgPSByZXF1aXJlKFwiLi9keW5hbWljLXZlcnNpb25zLmpzXCIpO1xuICB2YXIgbWlzc2luZztcblxuICBPYmplY3Qua2V5cyhpZHMpLmZvckVhY2goZnVuY3Rpb24gKGlkKSB7XG4gICAgdmFyIHZlcnNpb24gPSBkeW5hbWljVmVyc2lvbnMuZ2V0KGlkKTtcbiAgICBpZiAodmVyc2lvbikge1xuICAgICAgdmVyc2lvbnNbaWRdID0gdmVyc2lvbjtcbiAgICB9IGVsc2Uge1xuICAgICAgYWRkVG9UcmVlKG1pc3NpbmcgPSBtaXNzaW5nIHx8IE9iamVjdC5jcmVhdGUobnVsbCksIGlkLCAxKTtcbiAgICB9XG4gIH0pO1xuXG4gIHJldHVybiBjYWNoZS5jaGVja01hbnkodmVyc2lvbnMpLnRoZW4oZnVuY3Rpb24gKHNvdXJjZXMpIHtcbiAgICBPYmplY3Qua2V5cyhzb3VyY2VzKS5mb3JFYWNoKGZ1bmN0aW9uIChpZCkge1xuICAgICAgdmFyIHNvdXJjZSA9IHNvdXJjZXNbaWRdO1xuICAgICAgaWYgKHNvdXJjZSkge1xuICAgICAgICB2YXIgaW5mbyA9IGlkc1tpZF07XG4gICAgICAgIGFkZFRvVHJlZSh0cmVlLCBpZCwgbWFrZU1vZHVsZUZ1bmN0aW9uKGlkLCBzb3VyY2UsIGluZm8ub3B0aW9ucykpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYWRkVG9UcmVlKG1pc3NpbmcgPSBtaXNzaW5nIHx8IE9iamVjdC5jcmVhdGUobnVsbCksIGlkLCAxKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHJldHVybiBtaXNzaW5nICYmIGZldGNoTWlzc2luZyhtaXNzaW5nKS50aGVuKGZ1bmN0aW9uIChyZXN1bHRzKSB7XG4gICAgICB2YXIgdmVyc2lvbnNBbmRTb3VyY2VzQnlJZCA9IE9iamVjdC5jcmVhdGUobnVsbCk7XG4gICAgICB2YXIgZmxhdFJlc3VsdHMgPSBmbGF0dGVuTW9kdWxlVHJlZShyZXN1bHRzKTtcblxuICAgICAgT2JqZWN0LmtleXMoZmxhdFJlc3VsdHMpLmZvckVhY2goZnVuY3Rpb24gKGlkKSB7XG4gICAgICAgIHZhciBzb3VyY2UgPSBmbGF0UmVzdWx0c1tpZF07XG4gICAgICAgIHZhciBpbmZvID0gaWRzW2lkXTtcblxuICAgICAgICBhZGRUb1RyZWUodHJlZSwgaWQsIG1ha2VNb2R1bGVGdW5jdGlvbihpZCwgc291cmNlLCBpbmZvLm9wdGlvbnMpKTtcblxuICAgICAgICB2YXIgdmVyc2lvbiA9IGR5bmFtaWNWZXJzaW9ucy5nZXQoaWQpO1xuICAgICAgICBpZiAodmVyc2lvbikge1xuICAgICAgICAgIHZlcnNpb25zQW5kU291cmNlc0J5SWRbaWRdID0ge1xuICAgICAgICAgICAgdmVyc2lvbjogdmVyc2lvbixcbiAgICAgICAgICAgIHNvdXJjZTogc291cmNlXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGNhY2hlLnNldE1hbnkodmVyc2lvbnNBbmRTb3VyY2VzQnlJZCk7XG4gICAgfSk7XG5cbiAgfSkudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgcmV0dXJuIHRyZWU7XG4gIH0pO1xufTtcblxuZnVuY3Rpb24gZmxhdHRlbk1vZHVsZVRyZWUodHJlZSkge1xuICB2YXIgcGFydHMgPSBbXCJcIl07XG4gIHZhciByZXN1bHQgPSBPYmplY3QuY3JlYXRlKG51bGwpO1xuXG4gIGZ1bmN0aW9uIHdhbGsodCkge1xuICAgIGlmICh0ICYmIHR5cGVvZiB0ID09PSBcIm9iamVjdFwiKSB7XG4gICAgICBPYmplY3Qua2V5cyh0KS5mb3JFYWNoKGZ1bmN0aW9uIChrZXkpIHtcbiAgICAgICAgcGFydHMucHVzaChrZXkpO1xuICAgICAgICB3YWxrKHRba2V5XSk7XG4gICAgICAgIHBhcnRzLnBvcCgpO1xuICAgICAgfSk7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgdCA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgcmVzdWx0W3BhcnRzLmpvaW4oXCIvXCIpXSA9IHQ7XG4gICAgfVxuICB9XG5cbiAgd2Fsayh0cmVlKTtcblxuICByZXR1cm4gcmVzdWx0O1xufVxuXG5mdW5jdGlvbiBtYWtlTW9kdWxlRnVuY3Rpb24oaWQsIHNvdXJjZSwgb3B0aW9ucykge1xuICAvLyBCeSBjYWxsaW5nIChvcHRpb25zICYmIG9wdGlvbnMuZXZhbCB8fCBldmFsKSBpbiBhIHdyYXBwZXIgZnVuY3Rpb24sXG4gIC8vIHdlIGRlbGF5IHRoZSBjb3N0IG9mIHBhcnNpbmcgYW5kIGV2YWx1YXRpbmcgdGhlIG1vZHVsZSBjb2RlIHVudGlsIHRoZVxuICAvLyBtb2R1bGUgaXMgZmlyc3QgaW1wb3J0ZWQuXG4gIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgLy8gSWYgYW4gb3B0aW9ucy5ldmFsIGZ1bmN0aW9uIHdhcyBwcm92aWRlZCBpbiB0aGUgc2Vjb25kIGFyZ3VtZW50IHRvXG4gICAgLy8gbWV0ZW9ySW5zdGFsbCB3aGVuIHRoaXMgYnVuZGxlIHdhcyBmaXJzdCBpbnN0YWxsZWQsIHVzZSB0aGF0XG4gICAgLy8gZnVuY3Rpb24gdG8gcGFyc2UgYW5kIGV2YWx1YXRlIHRoZSBkeW5hbWljIG1vZHVsZSBjb2RlIGluIHRoZSBzY29wZVxuICAgIC8vIG9mIHRoZSBwYWNrYWdlLiBPdGhlcndpc2UgZmFsbCBiYWNrIHRvIGluZGlyZWN0IChnbG9iYWwpIGV2YWwuXG4gICAgcmV0dXJuIChvcHRpb25zICYmIG9wdGlvbnMuZXZhbCB8fCBldmFsKShcbiAgICAgIC8vIFdyYXAgdGhlIGZ1bmN0aW9uKHJlcXVpcmUsZXhwb3J0cyxtb2R1bGUpey4uLn0gZXhwcmVzc2lvbiBpblxuICAgICAgLy8gcGFyZW50aGVzZXMgdG8gZm9yY2UgaXQgdG8gYmUgcGFyc2VkIGFzIGFuIGV4cHJlc3Npb24uXG4gICAgICBcIihcIiArIHNvdXJjZSArIFwiKVxcbi8vIyBzb3VyY2VVUkw9XCIgKyBpZFxuICAgICkuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gZmV0Y2hNaXNzaW5nKG1pc3NpbmdUcmVlKSB7XG4gIC8vIFVwZGF0ZSBsYXN0RmV0Y2hNaXNzaW5nUHJvbWlzZSBpbW1lZGlhdGVseSwgd2l0aG91dCB3YWl0aW5nIGZvclxuICAvLyB0aGUgcmVzdWx0cyB0byBiZSBkZWxpdmVyZWQuXG4gIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbiAocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgTWV0ZW9yLmNhbGwoXG4gICAgICBcIl9fZHluYW1pY0ltcG9ydFwiLFxuICAgICAgbWlzc2luZ1RyZWUsXG4gICAgICBmdW5jdGlvbiAoZXJyb3IsIHJlc3VsdHNUcmVlKSB7XG4gICAgICAgIGVycm9yID8gcmVqZWN0KGVycm9yKSA6IHJlc29sdmUocmVzdWx0c1RyZWUpO1xuICAgICAgfVxuICAgICk7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBhZGRUb1RyZWUodHJlZSwgaWQsIHZhbHVlKSB7XG4gIHZhciBwYXJ0cyA9IGlkLnNwbGl0KFwiL1wiKTtcbiAgdmFyIGxhc3RJbmRleCA9IHBhcnRzLmxlbmd0aCAtIDE7XG4gIHBhcnRzLmZvckVhY2goZnVuY3Rpb24gKHBhcnQsIGkpIHtcbiAgICBpZiAocGFydCkge1xuICAgICAgdHJlZSA9IHRyZWVbcGFydF0gPSB0cmVlW3BhcnRdIHx8XG4gICAgICAgIChpIDwgbGFzdEluZGV4ID8gT2JqZWN0LmNyZWF0ZShudWxsKSA6IHZhbHVlKTtcbiAgICB9XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBnZXROYW1lc3BhY2UobW9kdWxlLCBpZCkge1xuICB2YXIgbmFtZXNwYWNlO1xuXG4gIG1vZHVsZS53YXRjaChtb2R1bGUucmVxdWlyZShpZCksIHtcbiAgICBcIipcIjogZnVuY3Rpb24gKG5zKSB7XG4gICAgICBuYW1lc3BhY2UgPSBucztcbiAgICB9XG4gIH0pO1xuXG4gIC8vIFRoaXMgaGVscHMgd2l0aCBCYWJlbCBpbnRlcm9wLCBzaW5jZSB3ZSdyZSBub3QganVzdCByZXR1cm5pbmcgdGhlXG4gIC8vIG1vZHVsZS5leHBvcnRzIG9iamVjdC5cbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KG5hbWVzcGFjZSwgXCJfX2VzTW9kdWxlXCIsIHtcbiAgICB2YWx1ZTogdHJ1ZSxcbiAgICBlbnVtZXJhYmxlOiBmYWxzZVxuICB9KTtcblxuICByZXR1cm4gbmFtZXNwYWNlO1xufVxuIiwiLy8gVGhpcyBtYWdpYyBkb3VibGUtdW5kZXJzY29yZWQgaWRlbnRpZmllciBnZXRzIHJlcGxhY2VkIGluXG4vLyB0b29scy9pc29idWlsZC9idW5kbGVyLmpzIHdpdGggYSB0cmVlIG9mIGhhc2hlcyBvZiBhbGwgZHluYW1pY1xuLy8gbW9kdWxlcywgZm9yIHVzZSBpbiBjbGllbnQuanMgYW5kIGNhY2hlLmpzLlxudmFyIHZlcnNpb25zID0gX19EWU5BTUlDX1ZFUlNJT05TX187XG5cbmV4cG9ydHMuZ2V0ID0gZnVuY3Rpb24gKGlkKSB7XG4gIHZhciB0cmVlID0gdmVyc2lvbnM7XG4gIHZhciB2ZXJzaW9uID0gbnVsbDtcblxuICBpZC5zcGxpdChcIi9cIikuc29tZShmdW5jdGlvbiAocGFydCkge1xuICAgIGlmIChwYXJ0KSB7XG4gICAgICAvLyBJZiB0aGUgdHJlZSBjb250YWlucyBpZGVudGlmaWVycyBmb3IgTWV0ZW9yIHBhY2thZ2VzIHdpdGggY29sb25zXG4gICAgICAvLyBpbiB0aGVpciBuYW1lcywgdGhlIGNvbG9ucyBzaG91bGQgbm90IGhhdmUgYmVlbiByZXBsYWNlZCBieVxuICAgICAgLy8gdW5kZXJzY29yZXMsIGJ1dCB0aGVyZSdzIGEgYnVnIHRoYXQgcmVzdWx0cyBpbiB0aGF0IGJlaGF2aW9yLCBzb1xuICAgICAgLy8gZm9yIG5vdyBpdCBzZWVtcyBzYWZlc3QgdG8gYmUgdG9sZXJhbnQgb2YgdW5kZXJzY29yZXMgaGVyZS5cbiAgICAgIC8vIGh0dHBzOi8vZ2l0aHViLmNvbS9tZXRlb3IvbWV0ZW9yL3B1bGwvOTEwM1xuICAgICAgdHJlZSA9IHRyZWVbcGFydF0gfHwgdHJlZVtwYXJ0LnJlcGxhY2UoXCI6XCIsIFwiX1wiKV07XG4gICAgfVxuXG4gICAgaWYgKCEgdHJlZSkge1xuICAgICAgLy8gVGVybWluYXRlIHRoZSBzZWFyY2ggd2l0aG91dCByZWFzc2lnbmluZyB2ZXJzaW9uLlxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiB0cmVlID09PSBcInN0cmluZ1wiKSB7XG4gICAgICB2ZXJzaW9uID0gdHJlZTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgfSk7XG5cbiAgcmV0dXJuIHZlcnNpb247XG59O1xuIiwiY29uc3QgYnBjID0gUGFja2FnZVtcImJyb3dzZXItcG9saWN5LWNvbnRlbnRcIl07XG5jb25zdCBCUCA9IGJwYyAmJiBicGMuQnJvd3NlclBvbGljeTtcbmNvbnN0IEJQYyA9IEJQICYmIEJQLmNvbnRlbnQ7XG5pZiAoQlBjKSB7XG4gIC8vIFRoZSBhYmlsaXR5IHRvIGV2YWx1YXRlIG5ldyBjb2RlIGlzIGVzc2VudGlhbCBmb3IgbG9hZGluZyBkeW5hbWljXG4gIC8vIG1vZHVsZXMuIFdpdGhvdXQgZXZhbCwgd2Ugd291bGQgYmUgZm9yY2VkIHRvIGxvYWQgbW9kdWxlcyB1c2luZ1xuICAvLyA8c2NyaXB0IHNyYz0uLi4+IHRhZ3MsIGFuZCB0aGVuIHRoZXJlIHdvdWxkIGJlIG5vIHdheSB0byBzYXZlIHRob3NlXG4gIC8vIG1vZHVsZXMgdG8gYSBsb2NhbCBjYWNoZSAob3IgbG9hZCB0aGVtIGZyb20gdGhlIGNhY2hlKSB3aXRob3V0IHRoZVxuICAvLyB1bmlxdWUgcmVzcG9uc2UgY2FjaGluZyBhYmlsaXRpZXMgb2Ygc2VydmljZSB3b3JrZXJzLCB3aGljaCBhcmUgbm90XG4gIC8vIGF2YWlsYWJsZSBpbiBhbGwgYnJvd3NlcnMsIGFuZCBjYW5ub3QgYmUgcG9seWZpbGxlZCBpbiBhIHdheSB0aGF0XG4gIC8vIHNhdGlzZmllcyBDb250ZW50IFNlY3VyaXR5IFBvbGljeSBldmFsIHJlc3RyaWN0aW9ucy4gTW9yZW92ZXIsIGV2YWxcbiAgLy8gYWxsb3dzIHVzIHRvIGV2YWx1YXRlIGR5bmFtaWMgbW9kdWxlIGNvZGUgaW4gdGhlIG9yaWdpbmFsIHBhY2thZ2VcbiAgLy8gc2NvcGUsIHdoaWNoIHdvdWxkIG5ldmVyIGJlIHBvc3NpYmxlIHVzaW5nIDxzY3JpcHQ+IHRhZ3MuIElmIHlvdSdyZVxuICAvLyBkZXBsb3lpbmcgYW4gYXBwIGluIGFuIGVudmlyb25tZW50IHRoYXQgZGVtYW5kcyBhIENvbnRlbnQgU2VjdXJpdHlcbiAgLy8gUG9saWN5IHRoYXQgZm9yYmlkcyBldmFsLCB5b3VyIG9ubHkgb3B0aW9uIGlzIHRvIGJ1bmRsZSBhbGwgZHluYW1pY1xuICAvLyBtb2R1bGVzIGluIHRoZSBpbml0aWFsIGJ1bmRsZS4gRm9ydHVuYXRlbHksIHRoYXQgd29ya3MgcGVyZmVjdGx5XG4gIC8vIHdlbGw7IHlvdSBqdXN0IHdvbid0IGdldCB0aGUgcGVyZm9ybWFuY2UgYmVuZWZpdHMgb2YgZHluYW1pYyBtb2R1bGVcbiAgLy8gZmV0Y2hpbmcuXG4gIEJQYy5hbGxvd0V2YWwoKTtcbn1cbiJdfQ==
