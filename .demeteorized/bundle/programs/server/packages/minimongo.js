(function () {

/* Imports */
var Meteor = Package.meteor.Meteor;
var global = Package.meteor.global;
var meteorEnv = Package.meteor.meteorEnv;
var DiffSequence = Package['diff-sequence'].DiffSequence;
var ECMAScript = Package.ecmascript.ECMAScript;
var EJSON = Package.ejson.EJSON;
var GeoJSON = Package['geojson-utils'].GeoJSON;
var IdMap = Package['id-map'].IdMap;
var MongoID = Package['mongo-id'].MongoID;
var OrderedDict = Package['ordered-dict'].OrderedDict;
var Random = Package.random.Random;
var Tracker = Package.tracker.Tracker;
var Deps = Package.tracker.Deps;
var meteorInstall = Package.modules.meteorInstall;
var meteorBabelHelpers = Package['babel-runtime'].meteorBabelHelpers;
var Promise = Package.promise.Promise;

/* Package-scope variables */
var operand, selectorValue, MinimongoTest, MinimongoError, selector, doc, callback, options, oldResults, a, b, LocalCollection, Minimongo;

var require = meteorInstall({"node_modules":{"meteor":{"minimongo":{"minimongo_server.js":function(require,exports,module){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/minimongo/minimongo_server.js                                                                              //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
module.watch(require("./minimongo_common.js"));
let hasOwn, isNumericKey, isOperatorObject, pathsToTree, projectionDetails;
module.watch(require("./common.js"), {
  hasOwn(v) {
    hasOwn = v;
  },

  isNumericKey(v) {
    isNumericKey = v;
  },

  isOperatorObject(v) {
    isOperatorObject = v;
  },

  pathsToTree(v) {
    pathsToTree = v;
  },

  projectionDetails(v) {
    projectionDetails = v;
  }

}, 0);

Minimongo._pathsElidingNumericKeys = paths => paths.map(path => path.split('.').filter(part => !isNumericKey(part)).join('.')); // Returns true if the modifier applied to some document may change the result
// of matching the document by selector
// The modifier is always in a form of Object:
//  - $set
//    - 'a.b.22.z': value
//    - 'foo.bar': 42
//  - $unset
//    - 'abc.d': 1


Minimongo.Matcher.prototype.affectedByModifier = function (modifier) {
  // safe check for $set/$unset being objects
  modifier = Object.assign({
    $set: {},
    $unset: {}
  }, modifier);

  const meaningfulPaths = this._getPaths();

  const modifiedPaths = [].concat(Object.keys(modifier.$set), Object.keys(modifier.$unset));
  return modifiedPaths.some(path => {
    const mod = path.split('.');
    return meaningfulPaths.some(meaningfulPath => {
      const sel = meaningfulPath.split('.');
      let i = 0,
          j = 0;

      while (i < sel.length && j < mod.length) {
        if (isNumericKey(sel[i]) && isNumericKey(mod[j])) {
          // foo.4.bar selector affected by foo.4 modifier
          // foo.3.bar selector unaffected by foo.4 modifier
          if (sel[i] === mod[j]) {
            i++;
            j++;
          } else {
            return false;
          }
        } else if (isNumericKey(sel[i])) {
          // foo.4.bar selector unaffected by foo.bar modifier
          return false;
        } else if (isNumericKey(mod[j])) {
          j++;
        } else if (sel[i] === mod[j]) {
          i++;
          j++;
        } else {
          return false;
        }
      } // One is a prefix of another, taking numeric fields into account


      return true;
    });
  });
}; // @param modifier - Object: MongoDB-styled modifier with `$set`s and `$unsets`
//                           only. (assumed to come from oplog)
// @returns - Boolean: if after applying the modifier, selector can start
//                     accepting the modified value.
// NOTE: assumes that document affected by modifier didn't match this Matcher
// before, so if modifier can't convince selector in a positive change it would
// stay 'false'.
// Currently doesn't support $-operators and numeric indices precisely.


Minimongo.Matcher.prototype.canBecomeTrueByModifier = function (modifier) {
  if (!this.affectedByModifier(modifier)) {
    return false;
  }

  if (!this.isSimple()) {
    return true;
  }

  modifier = Object.assign({
    $set: {},
    $unset: {}
  }, modifier);
  const modifierPaths = [].concat(Object.keys(modifier.$set), Object.keys(modifier.$unset));

  if (this._getPaths().some(pathHasNumericKeys) || modifierPaths.some(pathHasNumericKeys)) {
    return true;
  } // check if there is a $set or $unset that indicates something is an
  // object rather than a scalar in the actual object where we saw $-operator
  // NOTE: it is correct since we allow only scalars in $-operators
  // Example: for selector {'a.b': {$gt: 5}} the modifier {'a.b.c':7} would
  // definitely set the result to false as 'a.b' appears to be an object.


  const expectedScalarIsObject = Object.keys(this._selector).some(path => {
    if (!isOperatorObject(this._selector[path])) {
      return false;
    }

    return modifierPaths.some(modifierPath => modifierPath.startsWith(`${path}.`));
  });

  if (expectedScalarIsObject) {
    return false;
  } // See if we can apply the modifier on the ideally matching object. If it
  // still matches the selector, then the modifier could have turned the real
  // object in the database into something matching.


  const matchingDocument = EJSON.clone(this.matchingDocument()); // The selector is too complex, anything can happen.

  if (matchingDocument === null) {
    return true;
  }

  try {
    LocalCollection._modify(matchingDocument, modifier);
  } catch (error) {
    // Couldn't set a property on a field which is a scalar or null in the
    // selector.
    // Example:
    // real document: { 'a.b': 3 }
    // selector: { 'a': 12 }
    // converted selector (ideal document): { 'a': 12 }
    // modifier: { $set: { 'a.b': 4 } }
    // We don't know what real document was like but from the error raised by
    // $set on a scalar field we can reason that the structure of real document
    // is completely different.
    if (error.name === 'MinimongoError' && error.setPropertyError) {
      return false;
    }

    throw error;
  }

  return this.documentMatches(matchingDocument).result;
}; // Knows how to combine a mongo selector and a fields projection to a new fields
// projection taking into account active fields from the passed selector.
// @returns Object - projection object (same as fields option of mongo cursor)


Minimongo.Matcher.prototype.combineIntoProjection = function (projection) {
  const selectorPaths = Minimongo._pathsElidingNumericKeys(this._getPaths()); // Special case for $where operator in the selector - projection should depend
  // on all fields of the document. getSelectorPaths returns a list of paths
  // selector depends on. If one of the paths is '' (empty string) representing
  // the root or the whole document, complete projection should be returned.


  if (selectorPaths.includes('')) {
    return {};
  }

  return combineImportantPathsIntoProjection(selectorPaths, projection);
}; // Returns an object that would match the selector if possible or null if the
// selector is too complex for us to analyze
// { 'a.b': { ans: 42 }, 'foo.bar': null, 'foo.baz': "something" }
// => { a: { b: { ans: 42 } }, foo: { bar: null, baz: "something" } }


Minimongo.Matcher.prototype.matchingDocument = function () {
  // check if it was computed before
  if (this._matchingDocument !== undefined) {
    return this._matchingDocument;
  } // If the analysis of this selector is too hard for our implementation
  // fallback to "YES"


  let fallback = false;
  this._matchingDocument = pathsToTree(this._getPaths(), path => {
    const valueSelector = this._selector[path];

    if (isOperatorObject(valueSelector)) {
      // if there is a strict equality, there is a good
      // chance we can use one of those as "matching"
      // dummy value
      if (valueSelector.$eq) {
        return valueSelector.$eq;
      }

      if (valueSelector.$in) {
        const matcher = new Minimongo.Matcher({
          placeholder: valueSelector
        }); // Return anything from $in that matches the whole selector for this
        // path. If nothing matches, returns `undefined` as nothing can make
        // this selector into `true`.

        return valueSelector.$in.find(placeholder => matcher.documentMatches({
          placeholder
        }).result);
      }

      if (onlyContainsKeys(valueSelector, ['$gt', '$gte', '$lt', '$lte'])) {
        let lowerBound = -Infinity;
        let upperBound = Infinity;
        ['$lte', '$lt'].forEach(op => {
          if (hasOwn.call(valueSelector, op) && valueSelector[op] < upperBound) {
            upperBound = valueSelector[op];
          }
        });
        ['$gte', '$gt'].forEach(op => {
          if (hasOwn.call(valueSelector, op) && valueSelector[op] > lowerBound) {
            lowerBound = valueSelector[op];
          }
        });
        const middle = (lowerBound + upperBound) / 2;
        const matcher = new Minimongo.Matcher({
          placeholder: valueSelector
        });

        if (!matcher.documentMatches({
          placeholder: middle
        }).result && (middle === lowerBound || middle === upperBound)) {
          fallback = true;
        }

        return middle;
      }

      if (onlyContainsKeys(valueSelector, ['$nin', '$ne'])) {
        // Since this._isSimple makes sure $nin and $ne are not combined with
        // objects or arrays, we can confidently return an empty object as it
        // never matches any scalar.
        return {};
      }

      fallback = true;
    }

    return this._selector[path];
  }, x => x);

  if (fallback) {
    this._matchingDocument = null;
  }

  return this._matchingDocument;
}; // Minimongo.Sorter gets a similar method, which delegates to a Matcher it made
// for this exact purpose.


Minimongo.Sorter.prototype.affectedByModifier = function (modifier) {
  return this._selectorForAffectedByModifier.affectedByModifier(modifier);
};

Minimongo.Sorter.prototype.combineIntoProjection = function (projection) {
  return combineImportantPathsIntoProjection(Minimongo._pathsElidingNumericKeys(this._getPaths()), projection);
};

function combineImportantPathsIntoProjection(paths, projection) {
  const details = projectionDetails(projection); // merge the paths to include

  const tree = pathsToTree(paths, path => true, (node, path, fullPath) => true, details.tree);
  const mergedProjection = treeToPaths(tree);

  if (details.including) {
    // both selector and projection are pointing on fields to include
    // so we can just return the merged tree
    return mergedProjection;
  } // selector is pointing at fields to include
  // projection is pointing at fields to exclude
  // make sure we don't exclude important paths


  const mergedExclProjection = {};
  Object.keys(mergedProjection).forEach(path => {
    if (!mergedProjection[path]) {
      mergedExclProjection[path] = false;
    }
  });
  return mergedExclProjection;
}

function getPaths(selector) {
  return Object.keys(new Minimongo.Matcher(selector)._paths); // XXX remove it?
  // return Object.keys(selector).map(k => {
  //   // we don't know how to handle $where because it can be anything
  //   if (k === '$where') {
  //     return ''; // matches everything
  //   }
  //   // we branch from $or/$and/$nor operator
  //   if (['$or', '$and', '$nor'].includes(k)) {
  //     return selector[k].map(getPaths);
  //   }
  //   // the value is a literal or some comparison operator
  //   return k;
  // })
  //   .reduce((a, b) => a.concat(b), [])
  //   .filter((a, b, c) => c.indexOf(a) === b);
} // A helper to ensure object has only certain keys


function onlyContainsKeys(obj, keys) {
  return Object.keys(obj).every(k => keys.includes(k));
}

function pathHasNumericKeys(path) {
  return path.split('.').some(isNumericKey);
} // Returns a set of key paths similar to
// { 'foo.bar': 1, 'a.b.c': 1 }


function treeToPaths(tree, prefix = '') {
  const result = {};
  Object.keys(tree).forEach(key => {
    const value = tree[key];

    if (value === Object(value)) {
      Object.assign(result, treeToPaths(value, `${prefix + key}.`));
    } else {
      result[prefix + key] = value;
    }
  });
  return result;
}
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"common.js":function(require,exports,module){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/minimongo/common.js                                                                                        //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
module.export({
  hasOwn: () => hasOwn,
  ELEMENT_OPERATORS: () => ELEMENT_OPERATORS,
  compileDocumentSelector: () => compileDocumentSelector,
  equalityElementMatcher: () => equalityElementMatcher,
  expandArraysInBranches: () => expandArraysInBranches,
  isIndexable: () => isIndexable,
  isNumericKey: () => isNumericKey,
  isOperatorObject: () => isOperatorObject,
  makeLookupFunction: () => makeLookupFunction,
  nothingMatcher: () => nothingMatcher,
  pathsToTree: () => pathsToTree,
  populateDocumentWithQueryFields: () => populateDocumentWithQueryFields,
  projectionDetails: () => projectionDetails,
  regexpElementMatcher: () => regexpElementMatcher
});
let LocalCollection;
module.watch(require("./local_collection.js"), {
  default(v) {
    LocalCollection = v;
  }

}, 0);
const hasOwn = Object.prototype.hasOwnProperty;
const ELEMENT_OPERATORS = {
  $lt: makeInequality(cmpValue => cmpValue < 0),
  $gt: makeInequality(cmpValue => cmpValue > 0),
  $lte: makeInequality(cmpValue => cmpValue <= 0),
  $gte: makeInequality(cmpValue => cmpValue >= 0),
  $mod: {
    compileElementSelector(operand) {
      if (!(Array.isArray(operand) && operand.length === 2 && typeof operand[0] === 'number' && typeof operand[1] === 'number')) {
        throw Error('argument to $mod must be an array of two numbers');
      } // XXX could require to be ints or round or something


      const divisor = operand[0];
      const remainder = operand[1];
      return value => typeof value === 'number' && value % divisor === remainder;
    }

  },
  $in: {
    compileElementSelector(operand) {
      if (!Array.isArray(operand)) {
        throw Error('$in needs an array');
      }

      const elementMatchers = operand.map(option => {
        if (option instanceof RegExp) {
          return regexpElementMatcher(option);
        }

        if (isOperatorObject(option)) {
          throw Error('cannot nest $ under $in');
        }

        return equalityElementMatcher(option);
      });
      return value => {
        // Allow {a: {$in: [null]}} to match when 'a' does not exist.
        if (value === undefined) {
          value = null;
        }

        return elementMatchers.some(matcher => matcher(value));
      };
    }

  },
  $size: {
    // {a: [[5, 5]]} must match {a: {$size: 1}} but not {a: {$size: 2}}, so we
    // don't want to consider the element [5,5] in the leaf array [[5,5]] as a
    // possible value.
    dontExpandLeafArrays: true,

    compileElementSelector(operand) {
      if (typeof operand === 'string') {
        // Don't ask me why, but by experimentation, this seems to be what Mongo
        // does.
        operand = 0;
      } else if (typeof operand !== 'number') {
        throw Error('$size needs a number');
      }

      return value => Array.isArray(value) && value.length === operand;
    }

  },
  $type: {
    // {a: [5]} must not match {a: {$type: 4}} (4 means array), but it should
    // match {a: {$type: 1}} (1 means number), and {a: [[5]]} must match {$a:
    // {$type: 4}}. Thus, when we see a leaf array, we *should* expand it but
    // should *not* include it itself.
    dontIncludeLeafArrays: true,

    compileElementSelector(operand) {
      if (typeof operand !== 'number') {
        throw Error('$type needs a number');
      }

      return value => value !== undefined && LocalCollection._f._type(value) === operand;
    }

  },
  $bitsAllSet: {
    compileElementSelector(operand) {
      const mask = getOperandBitmask(operand, '$bitsAllSet');
      return value => {
        const bitmask = getValueBitmask(value, mask.length);
        return bitmask && mask.every((byte, i) => (bitmask[i] & byte) === byte);
      };
    }

  },
  $bitsAnySet: {
    compileElementSelector(operand) {
      const mask = getOperandBitmask(operand, '$bitsAnySet');
      return value => {
        const bitmask = getValueBitmask(value, mask.length);
        return bitmask && mask.some((byte, i) => (~bitmask[i] & byte) !== byte);
      };
    }

  },
  $bitsAllClear: {
    compileElementSelector(operand) {
      const mask = getOperandBitmask(operand, '$bitsAllClear');
      return value => {
        const bitmask = getValueBitmask(value, mask.length);
        return bitmask && mask.every((byte, i) => !(bitmask[i] & byte));
      };
    }

  },
  $bitsAnyClear: {
    compileElementSelector(operand) {
      const mask = getOperandBitmask(operand, '$bitsAnyClear');
      return value => {
        const bitmask = getValueBitmask(value, mask.length);
        return bitmask && mask.some((byte, i) => (bitmask[i] & byte) !== byte);
      };
    }

  },
  $regex: {
    compileElementSelector(operand, valueSelector) {
      if (!(typeof operand === 'string' || operand instanceof RegExp)) {
        throw Error('$regex has to be a string or RegExp');
      }

      let regexp;

      if (valueSelector.$options !== undefined) {
        // Options passed in $options (even the empty string) always overrides
        // options in the RegExp object itself.
        // Be clear that we only support the JS-supported options, not extended
        // ones (eg, Mongo supports x and s). Ideally we would implement x and s
        // by transforming the regexp, but not today...
        if (/[^gim]/.test(valueSelector.$options)) {
          throw new Error('Only the i, m, and g regexp options are supported');
        }

        const source = operand instanceof RegExp ? operand.source : operand;
        regexp = new RegExp(source, valueSelector.$options);
      } else if (operand instanceof RegExp) {
        regexp = operand;
      } else {
        regexp = new RegExp(operand);
      }

      return regexpElementMatcher(regexp);
    }

  },
  $elemMatch: {
    dontExpandLeafArrays: true,

    compileElementSelector(operand, valueSelector, matcher) {
      if (!LocalCollection._isPlainObject(operand)) {
        throw Error('$elemMatch need an object');
      }

      const isDocMatcher = !isOperatorObject(Object.keys(operand).filter(key => !hasOwn.call(LOGICAL_OPERATORS, key)).reduce((a, b) => Object.assign(a, {
        [b]: operand[b]
      }), {}), true);
      let subMatcher;

      if (isDocMatcher) {
        // This is NOT the same as compileValueSelector(operand), and not just
        // because of the slightly different calling convention.
        // {$elemMatch: {x: 3}} means "an element has a field x:3", not
        // "consists only of a field x:3". Also, regexps and sub-$ are allowed.
        subMatcher = compileDocumentSelector(operand, matcher, {
          inElemMatch: true
        });
      } else {
        subMatcher = compileValueSelector(operand, matcher);
      }

      return value => {
        if (!Array.isArray(value)) {
          return false;
        }

        for (let i = 0; i < value.length; ++i) {
          const arrayElement = value[i];
          let arg;

          if (isDocMatcher) {
            // We can only match {$elemMatch: {b: 3}} against objects.
            // (We can also match against arrays, if there's numeric indices,
            // eg {$elemMatch: {'0.b': 3}} or {$elemMatch: {0: 3}}.)
            if (!isIndexable(arrayElement)) {
              return false;
            }

            arg = arrayElement;
          } else {
            // dontIterate ensures that {a: {$elemMatch: {$gt: 5}}} matches
            // {a: [8]} but not {a: [[8]]}
            arg = [{
              value: arrayElement,
              dontIterate: true
            }];
          } // XXX support $near in $elemMatch by propagating $distance?


          if (subMatcher(arg).result) {
            return i; // specially understood to mean "use as arrayIndices"
          }
        }

        return false;
      };
    }

  }
};
// Operators that appear at the top level of a document selector.
const LOGICAL_OPERATORS = {
  $and(subSelector, matcher, inElemMatch) {
    return andDocumentMatchers(compileArrayOfDocumentSelectors(subSelector, matcher, inElemMatch));
  },

  $or(subSelector, matcher, inElemMatch) {
    const matchers = compileArrayOfDocumentSelectors(subSelector, matcher, inElemMatch); // Special case: if there is only one matcher, use it directly, *preserving*
    // any arrayIndices it returns.

    if (matchers.length === 1) {
      return matchers[0];
    }

    return doc => {
      const result = matchers.some(fn => fn(doc).result); // $or does NOT set arrayIndices when it has multiple
      // sub-expressions. (Tested against MongoDB.)

      return {
        result
      };
    };
  },

  $nor(subSelector, matcher, inElemMatch) {
    const matchers = compileArrayOfDocumentSelectors(subSelector, matcher, inElemMatch);
    return doc => {
      const result = matchers.every(fn => !fn(doc).result); // Never set arrayIndices, because we only match if nothing in particular
      // 'matched' (and because this is consistent with MongoDB).

      return {
        result
      };
    };
  },

  $where(selectorValue, matcher) {
    // Record that *any* path may be used.
    matcher._recordPathUsed('');

    matcher._hasWhere = true;

    if (!(selectorValue instanceof Function)) {
      // XXX MongoDB seems to have more complex logic to decide where or or not
      // to add 'return'; not sure exactly what it is.
      selectorValue = Function('obj', `return ${selectorValue}`);
    } // We make the document available as both `this` and `obj`.
    // // XXX not sure what we should do if this throws


    return doc => ({
      result: selectorValue.call(doc, doc)
    });
  },

  // This is just used as a comment in the query (in MongoDB, it also ends up in
  // query logs); it has no effect on the actual selection.
  $comment() {
    return () => ({
      result: true
    });
  }

}; // Operators that (unlike LOGICAL_OPERATORS) pertain to individual paths in a
// document, but (unlike ELEMENT_OPERATORS) do not have a simple definition as
// "match each branched value independently and combine with
// convertElementMatcherToBranchedMatcher".

const VALUE_OPERATORS = {
  $eq(operand) {
    return convertElementMatcherToBranchedMatcher(equalityElementMatcher(operand));
  },

  $not(operand, valueSelector, matcher) {
    return invertBranchedMatcher(compileValueSelector(operand, matcher));
  },

  $ne(operand) {
    return invertBranchedMatcher(convertElementMatcherToBranchedMatcher(equalityElementMatcher(operand)));
  },

  $nin(operand) {
    return invertBranchedMatcher(convertElementMatcherToBranchedMatcher(ELEMENT_OPERATORS.$in.compileElementSelector(operand)));
  },

  $exists(operand) {
    const exists = convertElementMatcherToBranchedMatcher(value => value !== undefined);
    return operand ? exists : invertBranchedMatcher(exists);
  },

  // $options just provides options for $regex; its logic is inside $regex
  $options(operand, valueSelector) {
    if (!hasOwn.call(valueSelector, '$regex')) {
      throw Error('$options needs a $regex');
    }

    return everythingMatcher;
  },

  // $maxDistance is basically an argument to $near
  $maxDistance(operand, valueSelector) {
    if (!valueSelector.$near) {
      throw Error('$maxDistance needs a $near');
    }

    return everythingMatcher;
  },

  $all(operand, valueSelector, matcher) {
    if (!Array.isArray(operand)) {
      throw Error('$all requires array');
    } // Not sure why, but this seems to be what MongoDB does.


    if (operand.length === 0) {
      return nothingMatcher;
    }

    const branchedMatchers = operand.map(criterion => {
      // XXX handle $all/$elemMatch combination
      if (isOperatorObject(criterion)) {
        throw Error('no $ expressions in $all');
      } // This is always a regexp or equality selector.


      return compileValueSelector(criterion, matcher);
    }); // andBranchedMatchers does NOT require all selectors to return true on the
    // SAME branch.

    return andBranchedMatchers(branchedMatchers);
  },

  $near(operand, valueSelector, matcher, isRoot) {
    if (!isRoot) {
      throw Error('$near can\'t be inside another $ operator');
    }

    matcher._hasGeoQuery = true; // There are two kinds of geodata in MongoDB: legacy coordinate pairs and
    // GeoJSON. They use different distance metrics, too. GeoJSON queries are
    // marked with a $geometry property, though legacy coordinates can be
    // matched using $geometry.

    let maxDistance, point, distance;

    if (LocalCollection._isPlainObject(operand) && hasOwn.call(operand, '$geometry')) {
      // GeoJSON "2dsphere" mode.
      maxDistance = operand.$maxDistance;
      point = operand.$geometry;

      distance = value => {
        // XXX: for now, we don't calculate the actual distance between, say,
        // polygon and circle. If people care about this use-case it will get
        // a priority.
        if (!value) {
          return null;
        }

        if (!value.type) {
          return GeoJSON.pointDistance(point, {
            type: 'Point',
            coordinates: pointToArray(value)
          });
        }

        if (value.type === 'Point') {
          return GeoJSON.pointDistance(point, value);
        }

        return GeoJSON.geometryWithinRadius(value, point, maxDistance) ? 0 : maxDistance + 1;
      };
    } else {
      maxDistance = valueSelector.$maxDistance;

      if (!isIndexable(operand)) {
        throw Error('$near argument must be coordinate pair or GeoJSON');
      }

      point = pointToArray(operand);

      distance = value => {
        if (!isIndexable(value)) {
          return null;
        }

        return distanceCoordinatePairs(point, value);
      };
    }

    return branchedValues => {
      // There might be multiple points in the document that match the given
      // field. Only one of them needs to be within $maxDistance, but we need to
      // evaluate all of them and use the nearest one for the implicit sort
      // specifier. (That's why we can't just use ELEMENT_OPERATORS here.)
      //
      // Note: This differs from MongoDB's implementation, where a document will
      // actually show up *multiple times* in the result set, with one entry for
      // each within-$maxDistance branching point.
      const result = {
        result: false
      };
      expandArraysInBranches(branchedValues).every(branch => {
        // if operation is an update, don't skip branches, just return the first
        // one (#3599)
        let curDistance;

        if (!matcher._isUpdate) {
          if (!(typeof branch.value === 'object')) {
            return true;
          }

          curDistance = distance(branch.value); // Skip branches that aren't real points or are too far away.

          if (curDistance === null || curDistance > maxDistance) {
            return true;
          } // Skip anything that's a tie.


          if (result.distance !== undefined && result.distance <= curDistance) {
            return true;
          }
        }

        result.result = true;
        result.distance = curDistance;

        if (branch.arrayIndices) {
          result.arrayIndices = branch.arrayIndices;
        } else {
          delete result.arrayIndices;
        }

        return !matcher._isUpdate;
      });
      return result;
    };
  }

}; // NB: We are cheating and using this function to implement 'AND' for both
// 'document matchers' and 'branched matchers'. They both return result objects
// but the argument is different: for the former it's a whole doc, whereas for
// the latter it's an array of 'branched values'.

function andSomeMatchers(subMatchers) {
  if (subMatchers.length === 0) {
    return everythingMatcher;
  }

  if (subMatchers.length === 1) {
    return subMatchers[0];
  }

  return docOrBranches => {
    const match = {};
    match.result = subMatchers.every(fn => {
      const subResult = fn(docOrBranches); // Copy a 'distance' number out of the first sub-matcher that has
      // one. Yes, this means that if there are multiple $near fields in a
      // query, something arbitrary happens; this appears to be consistent with
      // Mongo.

      if (subResult.result && subResult.distance !== undefined && match.distance === undefined) {
        match.distance = subResult.distance;
      } // Similarly, propagate arrayIndices from sub-matchers... but to match
      // MongoDB behavior, this time the *last* sub-matcher with arrayIndices
      // wins.


      if (subResult.result && subResult.arrayIndices) {
        match.arrayIndices = subResult.arrayIndices;
      }

      return subResult.result;
    }); // If we didn't actually match, forget any extra metadata we came up with.

    if (!match.result) {
      delete match.distance;
      delete match.arrayIndices;
    }

    return match;
  };
}

const andDocumentMatchers = andSomeMatchers;
const andBranchedMatchers = andSomeMatchers;

function compileArrayOfDocumentSelectors(selectors, matcher, inElemMatch) {
  if (!Array.isArray(selectors) || selectors.length === 0) {
    throw Error('$and/$or/$nor must be nonempty array');
  }

  return selectors.map(subSelector => {
    if (!LocalCollection._isPlainObject(subSelector)) {
      throw Error('$or/$and/$nor entries need to be full objects');
    }

    return compileDocumentSelector(subSelector, matcher, {
      inElemMatch
    });
  });
} // Takes in a selector that could match a full document (eg, the original
// selector). Returns a function mapping document->result object.
//
// matcher is the Matcher object we are compiling.
//
// If this is the root document selector (ie, not wrapped in $and or the like),
// then isRoot is true. (This is used by $near.)


function compileDocumentSelector(docSelector, matcher, options = {}) {
  const docMatchers = Object.keys(docSelector).map(key => {
    const subSelector = docSelector[key];

    if (key.substr(0, 1) === '$') {
      // Outer operators are either logical operators (they recurse back into
      // this function), or $where.
      if (!hasOwn.call(LOGICAL_OPERATORS, key)) {
        throw new Error(`Unrecognized logical operator: ${key}`);
      }

      matcher._isSimple = false;
      return LOGICAL_OPERATORS[key](subSelector, matcher, options.inElemMatch);
    } // Record this path, but only if we aren't in an elemMatcher, since in an
    // elemMatch this is a path inside an object in an array, not in the doc
    // root.


    if (!options.inElemMatch) {
      matcher._recordPathUsed(key);
    } // Don't add a matcher if subSelector is a function -- this is to match
    // the behavior of Meteor on the server (inherited from the node mongodb
    // driver), which is to ignore any part of a selector which is a function.


    if (typeof subSelector === 'function') {
      return undefined;
    }

    const lookUpByIndex = makeLookupFunction(key);
    const valueMatcher = compileValueSelector(subSelector, matcher, options.isRoot);
    return doc => valueMatcher(lookUpByIndex(doc));
  }).filter(Boolean);
  return andDocumentMatchers(docMatchers);
}

// Takes in a selector that could match a key-indexed value in a document; eg,
// {$gt: 5, $lt: 9}, or a regular expression, or any non-expression object (to
// indicate equality).  Returns a branched matcher: a function mapping
// [branched value]->result object.
function compileValueSelector(valueSelector, matcher, isRoot) {
  if (valueSelector instanceof RegExp) {
    matcher._isSimple = false;
    return convertElementMatcherToBranchedMatcher(regexpElementMatcher(valueSelector));
  }

  if (isOperatorObject(valueSelector)) {
    return operatorBranchedMatcher(valueSelector, matcher, isRoot);
  }

  return convertElementMatcherToBranchedMatcher(equalityElementMatcher(valueSelector));
} // Given an element matcher (which evaluates a single value), returns a branched
// value (which evaluates the element matcher on all the branches and returns a
// more structured return value possibly including arrayIndices).


function convertElementMatcherToBranchedMatcher(elementMatcher, options = {}) {
  return branches => {
    const expanded = options.dontExpandLeafArrays ? branches : expandArraysInBranches(branches, options.dontIncludeLeafArrays);
    const match = {};
    match.result = expanded.some(element => {
      let matched = elementMatcher(element.value); // Special case for $elemMatch: it means "true, and use this as an array
      // index if I didn't already have one".

      if (typeof matched === 'number') {
        // XXX This code dates from when we only stored a single array index
        // (for the outermost array). Should we be also including deeper array
        // indices from the $elemMatch match?
        if (!element.arrayIndices) {
          element.arrayIndices = [matched];
        }

        matched = true;
      } // If some element matched, and it's tagged with array indices, include
      // those indices in our result object.


      if (matched && element.arrayIndices) {
        match.arrayIndices = element.arrayIndices;
      }

      return matched;
    });
    return match;
  };
} // Helpers for $near.


function distanceCoordinatePairs(a, b) {
  const pointA = pointToArray(a);
  const pointB = pointToArray(b);
  return Math.hypot(pointA[0] - pointB[0], pointA[1] - pointB[1]);
} // Takes something that is not an operator object and returns an element matcher
// for equality with that thing.


function equalityElementMatcher(elementSelector) {
  if (isOperatorObject(elementSelector)) {
    throw Error('Can\'t create equalityValueSelector for operator object');
  } // Special-case: null and undefined are equal (if you got undefined in there
  // somewhere, or if you got it due to some branch being non-existent in the
  // weird special case), even though they aren't with EJSON.equals.
  // undefined or null


  if (elementSelector == null) {
    return value => value == null;
  }

  return value => LocalCollection._f._equal(elementSelector, value);
}

function everythingMatcher(docOrBranchedValues) {
  return {
    result: true
  };
}

function expandArraysInBranches(branches, skipTheArrays) {
  const branchesOut = [];
  branches.forEach(branch => {
    const thisIsArray = Array.isArray(branch.value); // We include the branch itself, *UNLESS* we it's an array that we're going
    // to iterate and we're told to skip arrays.  (That's right, we include some
    // arrays even skipTheArrays is true: these are arrays that were found via
    // explicit numerical indices.)

    if (!(skipTheArrays && thisIsArray && !branch.dontIterate)) {
      branchesOut.push({
        arrayIndices: branch.arrayIndices,
        value: branch.value
      });
    }

    if (thisIsArray && !branch.dontIterate) {
      branch.value.forEach((value, i) => {
        branchesOut.push({
          arrayIndices: (branch.arrayIndices || []).concat(i),
          value
        });
      });
    }
  });
  return branchesOut;
}

// Helpers for $bitsAllSet/$bitsAnySet/$bitsAllClear/$bitsAnyClear.
function getOperandBitmask(operand, selector) {
  // numeric bitmask
  // You can provide a numeric bitmask to be matched against the operand field.
  // It must be representable as a non-negative 32-bit signed integer.
  // Otherwise, $bitsAllSet will return an error.
  if (Number.isInteger(operand) && operand >= 0) {
    return new Uint8Array(new Int32Array([operand]).buffer);
  } // bindata bitmask
  // You can also use an arbitrarily large BinData instance as a bitmask.


  if (EJSON.isBinary(operand)) {
    return new Uint8Array(operand.buffer);
  } // position list
  // If querying a list of bit positions, each <position> must be a non-negative
  // integer. Bit positions start at 0 from the least significant bit.


  if (Array.isArray(operand) && operand.every(x => Number.isInteger(x) && x >= 0)) {
    const buffer = new ArrayBuffer((Math.max(...operand) >> 3) + 1);
    const view = new Uint8Array(buffer);
    operand.forEach(x => {
      view[x >> 3] |= 1 << (x & 0x7);
    });
    return view;
  } // bad operand


  throw Error(`operand to ${selector} must be a numeric bitmask (representable as a ` + 'non-negative 32-bit signed integer), a bindata bitmask or an array with ' + 'bit positions (non-negative integers)');
}

function getValueBitmask(value, length) {
  // The field value must be either numerical or a BinData instance. Otherwise,
  // $bits... will not match the current document.
  // numerical
  if (Number.isSafeInteger(value)) {
    // $bits... will not match numerical values that cannot be represented as a
    // signed 64-bit integer. This can be the case if a value is either too
    // large or small to fit in a signed 64-bit integer, or if it has a
    // fractional component.
    const buffer = new ArrayBuffer(Math.max(length, 2 * Uint32Array.BYTES_PER_ELEMENT));
    let view = new Uint32Array(buffer, 0, 2);
    view[0] = value % ((1 << 16) * (1 << 16)) | 0;
    view[1] = value / ((1 << 16) * (1 << 16)) | 0; // sign extension

    if (value < 0) {
      view = new Uint8Array(buffer, 2);
      view.forEach((byte, i) => {
        view[i] = 0xff;
      });
    }

    return new Uint8Array(buffer);
  } // bindata


  if (EJSON.isBinary(value)) {
    return new Uint8Array(value.buffer);
  } // no match


  return false;
} // Actually inserts a key value into the selector document
// However, this checks there is no ambiguity in setting
// the value for the given key, throws otherwise


function insertIntoDocument(document, key, value) {
  Object.keys(document).forEach(existingKey => {
    if (existingKey.length > key.length && existingKey.indexOf(`${key}.`) === 0 || key.length > existingKey.length && key.indexOf(`${existingKey}.`) === 0) {
      throw new Error(`cannot infer query fields to set, both paths '${existingKey}' and ` + `'${key}' are matched`);
    } else if (existingKey === key) {
      throw new Error(`cannot infer query fields to set, path '${key}' is matched twice`);
    }
  });
  document[key] = value;
} // Returns a branched matcher that matches iff the given matcher does not.
// Note that this implicitly "deMorganizes" the wrapped function.  ie, it
// means that ALL branch values need to fail to match innerBranchedMatcher.


function invertBranchedMatcher(branchedMatcher) {
  return branchValues => {
    // We explicitly choose to strip arrayIndices here: it doesn't make sense to
    // say "update the array element that does not match something", at least
    // in mongo-land.
    return {
      result: !branchedMatcher(branchValues).result
    };
  };
}

function isIndexable(obj) {
  return Array.isArray(obj) || LocalCollection._isPlainObject(obj);
}

function isNumericKey(s) {
  return (/^[0-9]+$/.test(s)
  );
}

function isOperatorObject(valueSelector, inconsistentOK) {
  if (!LocalCollection._isPlainObject(valueSelector)) {
    return false;
  }

  let theseAreOperators = undefined;
  Object.keys(valueSelector).forEach(selKey => {
    const thisIsOperator = selKey.substr(0, 1) === '$';

    if (theseAreOperators === undefined) {
      theseAreOperators = thisIsOperator;
    } else if (theseAreOperators !== thisIsOperator) {
      if (!inconsistentOK) {
        throw new Error(`Inconsistent operator: ${JSON.stringify(valueSelector)}`);
      }

      theseAreOperators = false;
    }
  });
  return !!theseAreOperators; // {} has no operators
}

// Helper for $lt/$gt/$lte/$gte.
function makeInequality(cmpValueComparator) {
  return {
    compileElementSelector(operand) {
      // Arrays never compare false with non-arrays for any inequality.
      // XXX This was behavior we observed in pre-release MongoDB 2.5, but
      //     it seems to have been reverted.
      //     See https://jira.mongodb.org/browse/SERVER-11444
      if (Array.isArray(operand)) {
        return () => false;
      } // Special case: consider undefined and null the same (so true with
      // $gte/$lte).


      if (operand === undefined) {
        operand = null;
      }

      const operandType = LocalCollection._f._type(operand);

      return value => {
        if (value === undefined) {
          value = null;
        } // Comparisons are never true among things of different type (except
        // null vs undefined).


        if (LocalCollection._f._type(value) !== operandType) {
          return false;
        }

        return cmpValueComparator(LocalCollection._f._cmp(value, operand));
      };
    }

  };
} // makeLookupFunction(key) returns a lookup function.
//
// A lookup function takes in a document and returns an array of matching
// branches.  If no arrays are found while looking up the key, this array will
// have exactly one branches (possibly 'undefined', if some segment of the key
// was not found).
//
// If arrays are found in the middle, this can have more than one element, since
// we 'branch'. When we 'branch', if there are more key segments to look up,
// then we only pursue branches that are plain objects (not arrays or scalars).
// This means we can actually end up with no branches!
//
// We do *NOT* branch on arrays that are found at the end (ie, at the last
// dotted member of the key). We just return that array; if you want to
// effectively 'branch' over the array's values, post-process the lookup
// function with expandArraysInBranches.
//
// Each branch is an object with keys:
//  - value: the value at the branch
//  - dontIterate: an optional bool; if true, it means that 'value' is an array
//    that expandArraysInBranches should NOT expand. This specifically happens
//    when there is a numeric index in the key, and ensures the
//    perhaps-surprising MongoDB behavior where {'a.0': 5} does NOT
//    match {a: [[5]]}.
//  - arrayIndices: if any array indexing was done during lookup (either due to
//    explicit numeric indices or implicit branching), this will be an array of
//    the array indices used, from outermost to innermost; it is falsey or
//    absent if no array index is used. If an explicit numeric index is used,
//    the index will be followed in arrayIndices by the string 'x'.
//
//    Note: arrayIndices is used for two purposes. First, it is used to
//    implement the '$' modifier feature, which only ever looks at its first
//    element.
//
//    Second, it is used for sort key generation, which needs to be able to tell
//    the difference between different paths. Moreover, it needs to
//    differentiate between explicit and implicit branching, which is why
//    there's the somewhat hacky 'x' entry: this means that explicit and
//    implicit array lookups will have different full arrayIndices paths. (That
//    code only requires that different paths have different arrayIndices; it
//    doesn't actually 'parse' arrayIndices. As an alternative, arrayIndices
//    could contain objects with flags like 'implicit', but I think that only
//    makes the code surrounding them more complex.)
//
//    (By the way, this field ends up getting passed around a lot without
//    cloning, so never mutate any arrayIndices field/var in this package!)
//
//
// At the top level, you may only pass in a plain object or array.
//
// See the test 'minimongo - lookup' for some examples of what lookup functions
// return.


function makeLookupFunction(key, options = {}) {
  const parts = key.split('.');
  const firstPart = parts.length ? parts[0] : '';
  const lookupRest = parts.length > 1 && makeLookupFunction(parts.slice(1).join('.'));

  const omitUnnecessaryFields = result => {
    if (!result.dontIterate) {
      delete result.dontIterate;
    }

    if (result.arrayIndices && !result.arrayIndices.length) {
      delete result.arrayIndices;
    }

    return result;
  }; // Doc will always be a plain object or an array.
  // apply an explicit numeric index, an array.


  return (doc, arrayIndices = []) => {
    if (Array.isArray(doc)) {
      // If we're being asked to do an invalid lookup into an array (non-integer
      // or out-of-bounds), return no results (which is different from returning
      // a single undefined result, in that `null` equality checks won't match).
      if (!(isNumericKey(firstPart) && firstPart < doc.length)) {
        return [];
      } // Remember that we used this array index. Include an 'x' to indicate that
      // the previous index came from being considered as an explicit array
      // index (not branching).


      arrayIndices = arrayIndices.concat(+firstPart, 'x');
    } // Do our first lookup.


    const firstLevel = doc[firstPart]; // If there is no deeper to dig, return what we found.
    //
    // If what we found is an array, most value selectors will choose to treat
    // the elements of the array as matchable values in their own right, but
    // that's done outside of the lookup function. (Exceptions to this are $size
    // and stuff relating to $elemMatch.  eg, {a: {$size: 2}} does not match {a:
    // [[1, 2]]}.)
    //
    // That said, if we just did an *explicit* array lookup (on doc) to find
    // firstLevel, and firstLevel is an array too, we do NOT want value
    // selectors to iterate over it.  eg, {'a.0': 5} does not match {a: [[5]]}.
    // So in that case, we mark the return value as 'don't iterate'.

    if (!lookupRest) {
      return [omitUnnecessaryFields({
        arrayIndices,
        dontIterate: Array.isArray(doc) && Array.isArray(firstLevel),
        value: firstLevel
      })];
    } // We need to dig deeper.  But if we can't, because what we've found is not
    // an array or plain object, we're done. If we just did a numeric index into
    // an array, we return nothing here (this is a change in Mongo 2.5 from
    // Mongo 2.4, where {'a.0.b': null} stopped matching {a: [5]}). Otherwise,
    // return a single `undefined` (which can, for example, match via equality
    // with `null`).


    if (!isIndexable(firstLevel)) {
      if (Array.isArray(doc)) {
        return [];
      }

      return [omitUnnecessaryFields({
        arrayIndices,
        value: undefined
      })];
    }

    const result = [];

    const appendToResult = more => {
      result.push(...more);
    }; // Dig deeper: look up the rest of the parts on whatever we've found.
    // (lookupRest is smart enough to not try to do invalid lookups into
    // firstLevel if it's an array.)


    appendToResult(lookupRest(firstLevel, arrayIndices)); // If we found an array, then in *addition* to potentially treating the next
    // part as a literal integer lookup, we should also 'branch': try to look up
    // the rest of the parts on each array element in parallel.
    //
    // In this case, we *only* dig deeper into array elements that are plain
    // objects. (Recall that we only got this far if we have further to dig.)
    // This makes sense: we certainly don't dig deeper into non-indexable
    // objects. And it would be weird to dig into an array: it's simpler to have
    // a rule that explicit integer indexes only apply to an outer array, not to
    // an array you find after a branching search.
    //
    // In the special case of a numeric part in a *sort selector* (not a query
    // selector), we skip the branching: we ONLY allow the numeric part to mean
    // 'look up this index' in that case, not 'also look up this index in all
    // the elements of the array'.

    if (Array.isArray(firstLevel) && !(isNumericKey(parts[1]) && options.forSort)) {
      firstLevel.forEach((branch, arrayIndex) => {
        if (LocalCollection._isPlainObject(branch)) {
          appendToResult(lookupRest(branch, arrayIndices.concat(arrayIndex)));
        }
      });
    }

    return result;
  };
}

// Object exported only for unit testing.
// Use it to export private functions to test in Tinytest.
MinimongoTest = {
  makeLookupFunction
};

MinimongoError = (message, options = {}) => {
  if (typeof message === 'string' && options.field) {
    message += ` for field '${options.field}'`;
  }

  const error = new Error(message);
  error.name = 'MinimongoError';
  return error;
};

function nothingMatcher(docOrBranchedValues) {
  return {
    result: false
  };
}

// Takes an operator object (an object with $ keys) and returns a branched
// matcher for it.
function operatorBranchedMatcher(valueSelector, matcher, isRoot) {
  // Each valueSelector works separately on the various branches.  So one
  // operator can match one branch and another can match another branch.  This
  // is OK.
  const operatorMatchers = Object.keys(valueSelector).map(operator => {
    const operand = valueSelector[operator];
    const simpleRange = ['$lt', '$lte', '$gt', '$gte'].includes(operator) && typeof operand === 'number';
    const simpleEquality = ['$ne', '$eq'].includes(operator) && operand !== Object(operand);
    const simpleInclusion = ['$in', '$nin'].includes(operator) && Array.isArray(operand) && !operand.some(x => x === Object(x));

    if (!(simpleRange || simpleInclusion || simpleEquality)) {
      matcher._isSimple = false;
    }

    if (hasOwn.call(VALUE_OPERATORS, operator)) {
      return VALUE_OPERATORS[operator](operand, valueSelector, matcher, isRoot);
    }

    if (hasOwn.call(ELEMENT_OPERATORS, operator)) {
      const options = ELEMENT_OPERATORS[operator];
      return convertElementMatcherToBranchedMatcher(options.compileElementSelector(operand, valueSelector, matcher), options);
    }

    throw new Error(`Unrecognized operator: ${operator}`);
  });
  return andBranchedMatchers(operatorMatchers);
} // paths - Array: list of mongo style paths
// newLeafFn - Function: of form function(path) should return a scalar value to
//                       put into list created for that path
// conflictFn - Function: of form function(node, path, fullPath) is called
//                        when building a tree path for 'fullPath' node on
//                        'path' was already a leaf with a value. Must return a
//                        conflict resolution.
// initial tree - Optional Object: starting tree.
// @returns - Object: tree represented as a set of nested objects


function pathsToTree(paths, newLeafFn, conflictFn, root = {}) {
  paths.forEach(path => {
    const pathArray = path.split('.');
    let tree = root; // use .every just for iteration with break

    const success = pathArray.slice(0, -1).every((key, i) => {
      if (!hasOwn.call(tree, key)) {
        tree[key] = {};
      } else if (tree[key] !== Object(tree[key])) {
        tree[key] = conflictFn(tree[key], pathArray.slice(0, i + 1).join('.'), path); // break out of loop if we are failing for this path

        if (tree[key] !== Object(tree[key])) {
          return false;
        }
      }

      tree = tree[key];
      return true;
    });

    if (success) {
      const lastKey = pathArray[pathArray.length - 1];

      if (hasOwn.call(tree, lastKey)) {
        tree[lastKey] = conflictFn(tree[lastKey], path, path);
      } else {
        tree[lastKey] = newLeafFn(path);
      }
    }
  });
  return root;
}

// Makes sure we get 2 elements array and assume the first one to be x and
// the second one to y no matter what user passes.
// In case user passes { lon: x, lat: y } returns [x, y]
function pointToArray(point) {
  return Array.isArray(point) ? point.slice() : [point.x, point.y];
} // Creating a document from an upsert is quite tricky.
// E.g. this selector: {"$or": [{"b.foo": {"$all": ["bar"]}}]}, should result
// in: {"b.foo": "bar"}
// But this selector: {"$or": [{"b": {"foo": {"$all": ["bar"]}}}]} should throw
// an error
// Some rules (found mainly with trial & error, so there might be more):
// - handle all childs of $and (or implicit $and)
// - handle $or nodes with exactly 1 child
// - ignore $or nodes with more than 1 child
// - ignore $nor and $not nodes
// - throw when a value can not be set unambiguously
// - every value for $all should be dealt with as separate $eq-s
// - threat all children of $all as $eq setters (=> set if $all.length === 1,
//   otherwise throw error)
// - you can not mix '$'-prefixed keys and non-'$'-prefixed keys
// - you can only have dotted keys on a root-level
// - you can not have '$'-prefixed keys more than one-level deep in an object
// Handles one key/value pair to put in the selector document


function populateDocumentWithKeyValue(document, key, value) {
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    populateDocumentWithObject(document, key, value);
  } else if (!(value instanceof RegExp)) {
    insertIntoDocument(document, key, value);
  }
} // Handles a key, value pair to put in the selector document
// if the value is an object


function populateDocumentWithObject(document, key, value) {
  const keys = Object.keys(value);
  const unprefixedKeys = keys.filter(op => op[0] !== '$');

  if (unprefixedKeys.length > 0 || !keys.length) {
    // Literal (possibly empty) object ( or empty object )
    // Don't allow mixing '$'-prefixed with non-'$'-prefixed fields
    if (keys.length !== unprefixedKeys.length) {
      throw new Error(`unknown operator: ${unprefixedKeys[0]}`);
    }

    validateObject(value, key);
    insertIntoDocument(document, key, value);
  } else {
    Object.keys(value).forEach(op => {
      const object = value[op];

      if (op === '$eq') {
        populateDocumentWithKeyValue(document, key, object);
      } else if (op === '$all') {
        // every value for $all should be dealt with as separate $eq-s
        object.forEach(element => populateDocumentWithKeyValue(document, key, element));
      }
    });
  }
} // Fills a document with certain fields from an upsert selector


function populateDocumentWithQueryFields(query, document = {}) {
  if (Object.getPrototypeOf(query) === Object.prototype) {
    // handle implicit $and
    Object.keys(query).forEach(key => {
      const value = query[key];

      if (key === '$and') {
        // handle explicit $and
        value.forEach(element => populateDocumentWithQueryFields(element, document));
      } else if (key === '$or') {
        // handle $or nodes with exactly 1 child
        if (value.length === 1) {
          populateDocumentWithQueryFields(value[0], document);
        }
      } else if (key[0] !== '$') {
        // Ignore other '$'-prefixed logical selectors
        populateDocumentWithKeyValue(document, key, value);
      }
    });
  } else {
    // Handle meteor-specific shortcut for selecting _id
    if (LocalCollection._selectorIsId(query)) {
      insertIntoDocument(document, '_id', query);
    }
  }

  return document;
}

function projectionDetails(fields) {
  // Find the non-_id keys (_id is handled specially because it is included
  // unless explicitly excluded). Sort the keys, so that our code to detect
  // overlaps like 'foo' and 'foo.bar' can assume that 'foo' comes first.
  let fieldsKeys = Object.keys(fields).sort(); // If _id is the only field in the projection, do not remove it, since it is
  // required to determine if this is an exclusion or exclusion. Also keep an
  // inclusive _id, since inclusive _id follows the normal rules about mixing
  // inclusive and exclusive fields. If _id is not the only field in the
  // projection and is exclusive, remove it so it can be handled later by a
  // special case, since exclusive _id is always allowed.

  if (!(fieldsKeys.length === 1 && fieldsKeys[0] === '_id') && !(fieldsKeys.includes('_id') && fields._id)) {
    fieldsKeys = fieldsKeys.filter(key => key !== '_id');
  }

  let including = null; // Unknown

  fieldsKeys.forEach(keyPath => {
    const rule = !!fields[keyPath];

    if (including === null) {
      including = rule;
    } // This error message is copied from MongoDB shell


    if (including !== rule) {
      throw MinimongoError('You cannot currently mix including and excluding fields.');
    }
  });
  const projectionRulesTree = pathsToTree(fieldsKeys, path => including, (node, path, fullPath) => {
    // Check passed projection fields' keys: If you have two rules such as
    // 'foo.bar' and 'foo.bar.baz', then the result becomes ambiguous. If
    // that happens, there is a probability you are doing something wrong,
    // framework should notify you about such mistake earlier on cursor
    // compilation step than later during runtime.  Note, that real mongo
    // doesn't do anything about it and the later rule appears in projection
    // project, more priority it takes.
    //
    // Example, assume following in mongo shell:
    // > db.coll.insert({ a: { b: 23, c: 44 } })
    // > db.coll.find({}, { 'a': 1, 'a.b': 1 })
    // {"_id": ObjectId("520bfe456024608e8ef24af3"), "a": {"b": 23}}
    // > db.coll.find({}, { 'a.b': 1, 'a': 1 })
    // {"_id": ObjectId("520bfe456024608e8ef24af3"), "a": {"b": 23, "c": 44}}
    //
    // Note, how second time the return set of keys is different.
    const currentPath = fullPath;
    const anotherPath = path;
    throw MinimongoError(`both ${currentPath} and ${anotherPath} found in fields option, ` + 'using both of them may trigger unexpected behavior. Did you mean to ' + 'use only one of them?');
  });
  return {
    including,
    tree: projectionRulesTree
  };
}

function regexpElementMatcher(regexp) {
  return value => {
    if (value instanceof RegExp) {
      return value.toString() === regexp.toString();
    } // Regexps only work against strings.


    if (typeof value !== 'string') {
      return false;
    } // Reset regexp's state to avoid inconsistent matching for objects with the
    // same value on consecutive calls of regexp.test. This happens only if the
    // regexp has the 'g' flag. Also note that ES6 introduces a new flag 'y' for
    // which we should *not* change the lastIndex but MongoDB doesn't support
    // either of these flags.


    regexp.lastIndex = 0;
    return regexp.test(value);
  };
}

// Validates the key in a path.
// Objects that are nested more then 1 level cannot have dotted fields
// or fields starting with '$'
function validateKeyInPath(key, path) {
  if (key.includes('.')) {
    throw new Error(`The dotted field '${key}' in '${path}.${key} is not valid for storage.`);
  }

  if (key[0] === '$') {
    throw new Error(`The dollar ($) prefixed field  '${path}.${key} is not valid for storage.`);
  }
} // Recursively validates an object that is nested more than one level deep


function validateObject(object, path) {
  if (object && Object.getPrototypeOf(object) === Object.prototype) {
    Object.keys(object).forEach(key => {
      validateKeyInPath(key, path);
      validateObject(object[key], path + '.' + key);
    });
  }
}
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"cursor.js":function(require,exports,module){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/minimongo/cursor.js                                                                                        //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
module.export({
  default: () => Cursor
});
let LocalCollection;
module.watch(require("./local_collection.js"), {
  default(v) {
    LocalCollection = v;
  }

}, 0);
let hasOwn;
module.watch(require("./common.js"), {
  hasOwn(v) {
    hasOwn = v;
  }

}, 1);

class Cursor {
  // don't call this ctor directly.  use LocalCollection.find().
  constructor(collection, selector, options = {}) {
    this.collection = collection;
    this.sorter = null;
    this.matcher = new Minimongo.Matcher(selector);

    if (LocalCollection._selectorIsIdPerhapsAsObject(selector)) {
      // stash for fast _id and { _id }
      this._selectorId = hasOwn.call(selector, '_id') ? selector._id : selector;
    } else {
      this._selectorId = undefined;

      if (this.matcher.hasGeoQuery() || options.sort) {
        this.sorter = new Minimongo.Sorter(options.sort || [], {
          matcher: this.matcher
        });
      }
    }

    this.skip = options.skip || 0;
    this.limit = options.limit;
    this.fields = options.fields;
    this._projectionFn = LocalCollection._compileProjection(this.fields || {});
    this._transform = LocalCollection.wrapTransform(options.transform); // by default, queries register w/ Tracker when it is available.

    if (typeof Tracker !== 'undefined') {
      this.reactive = options.reactive === undefined ? true : options.reactive;
    }
  } /**
     * @summary Returns the number of documents that match a query.
     * @memberOf Mongo.Cursor
     * @method  count
     * @instance
     * @locus Anywhere
     * @returns {Number}
     */

  count() {
    if (this.reactive) {
      // allow the observe to be unordered
      this._depend({
        added: true,
        removed: true
      }, true);
    }

    return this._getRawObjects({
      ordered: true
    }).length;
  } /**
     * @summary Return all matching documents as an Array.
     * @memberOf Mongo.Cursor
     * @method  fetch
     * @instance
     * @locus Anywhere
     * @returns {Object[]}
     */

  fetch() {
    const result = [];
    this.forEach(doc => {
      result.push(doc);
    });
    return result;
  }

  [Symbol.iterator]() {
    if (this.reactive) {
      this._depend({
        addedBefore: true,
        removed: true,
        changed: true,
        movedBefore: true
      });
    }

    let index = 0;

    const objects = this._getRawObjects({
      ordered: true
    });

    return {
      next: () => {
        if (index < objects.length) {
          // This doubles as a clone operation.
          let element = this._projectionFn(objects[index++]);

          if (this._transform) element = this._transform(element);
          return {
            value: element
          };
        }

        return {
          done: true
        };
      }
    };
  } /**
     * @callback IterationCallback
     * @param {Object} doc
     * @param {Number} index
     */ /**
         * @summary Call `callback` once for each matching document, sequentially and
         *          synchronously.
         * @locus Anywhere
         * @method  forEach
         * @instance
         * @memberOf Mongo.Cursor
         * @param {IterationCallback} callback Function to call. It will be called
         *                                     with three arguments: the document, a
         *                                     0-based index, and <em>cursor</em>
         *                                     itself.
         * @param {Any} [thisArg] An object which will be the value of `this` inside
         *                        `callback`.
         */

  forEach(callback, thisArg) {
    if (this.reactive) {
      this._depend({
        addedBefore: true,
        removed: true,
        changed: true,
        movedBefore: true
      });
    }

    this._getRawObjects({
      ordered: true
    }).forEach((element, i) => {
      // This doubles as a clone operation.
      element = this._projectionFn(element);

      if (this._transform) {
        element = this._transform(element);
      }

      callback.call(thisArg, element, i, this);
    });
  }

  getTransform() {
    return this._transform;
  } /**
     * @summary Map callback over all matching documents.  Returns an Array.
     * @locus Anywhere
     * @method map
     * @instance
     * @memberOf Mongo.Cursor
     * @param {IterationCallback} callback Function to call. It will be called
     *                                     with three arguments: the document, a
     *                                     0-based index, and <em>cursor</em>
     *                                     itself.
     * @param {Any} [thisArg] An object which will be the value of `this` inside
     *                        `callback`.
     */

  map(callback, thisArg) {
    const result = [];
    this.forEach((doc, i) => {
      result.push(callback.call(thisArg, doc, i, this));
    });
    return result;
  } // options to contain:
  //  * callbacks for observe():
  //    - addedAt (document, atIndex)
  //    - added (document)
  //    - changedAt (newDocument, oldDocument, atIndex)
  //    - changed (newDocument, oldDocument)
  //    - removedAt (document, atIndex)
  //    - removed (document)
  //    - movedTo (document, oldIndex, newIndex)
  //
  // attributes available on returned query handle:
  //  * stop(): end updates
  //  * collection: the collection this query is querying
  //
  // iff x is a returned query handle, (x instanceof
  // LocalCollection.ObserveHandle) is true
  //
  // initial results delivered through added callback
  // XXX maybe callbacks should take a list of objects, to expose transactions?
  // XXX maybe support field limiting (to limit what you're notified on)
  /**
   * @summary Watch a query.  Receive callbacks as the result set changes.
   * @locus Anywhere
   * @memberOf Mongo.Cursor
   * @instance
   * @param {Object} callbacks Functions to call to deliver the result set as it
   *                           changes
   */

  observe(options) {
    return LocalCollection._observeFromObserveChanges(this, options);
  } /**
     * @summary Watch a query. Receive callbacks as the result set changes. Only
     *          the differences between the old and new documents are passed to
     *          the callbacks.
     * @locus Anywhere
     * @memberOf Mongo.Cursor
     * @instance
     * @param {Object} callbacks Functions to call to deliver the result set as it
     *                           changes
     */

  observeChanges(options) {
    const ordered = LocalCollection._observeChangesCallbacksAreOrdered(options); // there are several places that assume you aren't combining skip/limit with
    // unordered observe.  eg, update's EJSON.clone, and the "there are several"
    // comment in _modifyAndNotify
    // XXX allow skip/limit with unordered observe


    if (!options._allow_unordered && !ordered && (this.skip || this.limit)) {
      throw new Error('must use ordered observe (ie, \'addedBefore\' instead of \'added\') ' + 'with skip or limit');
    }

    if (this.fields && (this.fields._id === 0 || this.fields._id === false)) {
      throw Error('You may not observe a cursor with {fields: {_id: 0}}');
    }

    const distances = this.matcher.hasGeoQuery() && ordered && new LocalCollection._IdMap();
    const query = {
      cursor: this,
      dirty: false,
      distances,
      matcher: this.matcher,
      // not fast pathed
      ordered,
      projectionFn: this._projectionFn,
      resultsSnapshot: null,
      sorter: ordered && this.sorter
    };
    let qid; // Non-reactive queries call added[Before] and then never call anything
    // else.

    if (this.reactive) {
      qid = this.collection.next_qid++;
      this.collection.queries[qid] = query;
    }

    query.results = this._getRawObjects({
      ordered,
      distances: query.distances
    });

    if (this.collection.paused) {
      query.resultsSnapshot = ordered ? [] : new LocalCollection._IdMap();
    } // wrap callbacks we were passed. callbacks only fire when not paused and
    // are never undefined
    // Filters out blacklisted fields according to cursor's projection.
    // XXX wrong place for this?
    // furthermore, callbacks enqueue until the operation we're working on is
    // done.


    const wrapCallback = fn => {
      if (!fn) {
        return () => {};
      }

      const self = this;
      return function () /* args*/{
        if (self.collection.paused) {
          return;
        }

        const args = arguments;

        self.collection._observeQueue.queueTask(() => {
          fn.apply(this, args);
        });
      };
    };

    query.added = wrapCallback(options.added);
    query.changed = wrapCallback(options.changed);
    query.removed = wrapCallback(options.removed);

    if (ordered) {
      query.addedBefore = wrapCallback(options.addedBefore);
      query.movedBefore = wrapCallback(options.movedBefore);
    }

    if (!options._suppress_initial && !this.collection.paused) {
      const results = ordered ? query.results : query.results._map;
      Object.keys(results).forEach(key => {
        const doc = results[key];
        const fields = EJSON.clone(doc);
        delete fields._id;

        if (ordered) {
          query.addedBefore(doc._id, this._projectionFn(fields), null);
        }

        query.added(doc._id, this._projectionFn(fields));
      });
    }

    const handle = Object.assign(new LocalCollection.ObserveHandle(), {
      collection: this.collection,
      stop: () => {
        if (this.reactive) {
          delete this.collection.queries[qid];
        }
      }
    });

    if (this.reactive && Tracker.active) {
      // XXX in many cases, the same observe will be recreated when
      // the current autorun is rerun.  we could save work by
      // letting it linger across rerun and potentially get
      // repurposed if the same observe is performed, using logic
      // similar to that of Meteor.subscribe.
      Tracker.onInvalidate(() => {
        handle.stop();
      });
    } // run the observe callbacks resulting from the initial contents
    // before we leave the observe.


    this.collection._observeQueue.drain();

    return handle;
  } // Since we don't actually have a "nextObject" interface, there's really no
  // reason to have a "rewind" interface.  All it did was make multiple calls
  // to fetch/map/forEach return nothing the second time.
  // XXX COMPAT WITH 0.8.1


  rewind() {} // XXX Maybe we need a version of observe that just calls a callback if
  // anything changed.


  _depend(changers, _allow_unordered) {
    if (Tracker.active) {
      const dependency = new Tracker.Dependency();
      const notify = dependency.changed.bind(dependency);
      dependency.depend();
      const options = {
        _allow_unordered,
        _suppress_initial: true
      };
      ['added', 'addedBefore', 'changed', 'movedBefore', 'removed'].forEach(fn => {
        if (changers[fn]) {
          options[fn] = notify;
        }
      }); // observeChanges will stop() when this computation is invalidated

      this.observeChanges(options);
    }
  }

  _getCollectionName() {
    return this.collection.name;
  } // Returns a collection of matching objects, but doesn't deep copy them.
  //
  // If ordered is set, returns a sorted array, respecting sorter, skip, and
  // limit properties of the query.  if sorter is falsey, no sort -- you get the
  // natural order.
  //
  // If ordered is not set, returns an object mapping from ID to doc (sorter,
  // skip and limit should not be set).
  //
  // If ordered is set and this cursor is a $near geoquery, then this function
  // will use an _IdMap to track each distance from the $near argument point in
  // order to use it as a sort key. If an _IdMap is passed in the 'distances'
  // argument, this function will clear it and use it for this purpose
  // (otherwise it will just create its own _IdMap). The observeChanges
  // implementation uses this to remember the distances after this function
  // returns.


  _getRawObjects(options = {}) {
    // XXX use OrderedDict instead of array, and make IdMap and OrderedDict
    // compatible
    const results = options.ordered ? [] : new LocalCollection._IdMap(); // fast path for single ID value

    if (this._selectorId !== undefined) {
      // If you have non-zero skip and ask for a single id, you get
      // nothing. This is so it matches the behavior of the '{_id: foo}'
      // path.
      if (this.skip) {
        return results;
      }

      const selectedDoc = this.collection._docs.get(this._selectorId);

      if (selectedDoc) {
        if (options.ordered) {
          results.push(selectedDoc);
        } else {
          results.set(this._selectorId, selectedDoc);
        }
      }

      return results;
    } // slow path for arbitrary selector, sort, skip, limit
    // in the observeChanges case, distances is actually part of the "query"
    // (ie, live results set) object.  in other cases, distances is only used
    // inside this function.


    let distances;

    if (this.matcher.hasGeoQuery() && options.ordered) {
      if (options.distances) {
        distances = options.distances;
        distances.clear();
      } else {
        distances = new LocalCollection._IdMap();
      }
    }

    this.collection._docs.forEach((doc, id) => {
      const matchResult = this.matcher.documentMatches(doc);

      if (matchResult.result) {
        if (options.ordered) {
          results.push(doc);

          if (distances && matchResult.distance !== undefined) {
            distances.set(id, matchResult.distance);
          }
        } else {
          results.set(id, doc);
        }
      } // Fast path for limited unsorted queries.
      // XXX 'length' check here seems wrong for ordered


      return !this.limit || this.skip || this.sorter || results.length !== this.limit;
    });

    if (!options.ordered) {
      return results;
    }

    if (this.sorter) {
      results.sort(this.sorter.getComparator({
        distances
      }));
    }

    if (!this.limit && !this.skip) {
      return results;
    }

    return results.slice(this.skip, this.limit ? this.limit + this.skip : results.length);
  }

  _publishCursor(subscription) {
    // XXX minimongo should not depend on mongo-livedata!
    if (!Package.mongo) {
      throw new Error('Can\'t publish from Minimongo without the `mongo` package.');
    }

    if (!this.collection.name) {
      throw new Error('Can\'t publish a cursor from a collection without a name.');
    }

    return Package.mongo.Mongo.Collection._publishCursor(this, subscription, this.collection.name);
  }

}
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"local_collection.js":function(require,exports,module){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/minimongo/local_collection.js                                                                              //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
module.export({
  default: () => LocalCollection
});
let Cursor;
module.watch(require("./cursor.js"), {
  default(v) {
    Cursor = v;
  }

}, 0);
let ObserveHandle;
module.watch(require("./observe_handle.js"), {
  default(v) {
    ObserveHandle = v;
  }

}, 1);
let hasOwn, isIndexable, isNumericKey, isOperatorObject, populateDocumentWithQueryFields, projectionDetails;
module.watch(require("./common.js"), {
  hasOwn(v) {
    hasOwn = v;
  },

  isIndexable(v) {
    isIndexable = v;
  },

  isNumericKey(v) {
    isNumericKey = v;
  },

  isOperatorObject(v) {
    isOperatorObject = v;
  },

  populateDocumentWithQueryFields(v) {
    populateDocumentWithQueryFields = v;
  },

  projectionDetails(v) {
    projectionDetails = v;
  }

}, 2);

class LocalCollection {
  constructor(name) {
    this.name = name; // _id -> document (also containing id)

    this._docs = new LocalCollection._IdMap();
    this._observeQueue = new Meteor._SynchronousQueue();
    this.next_qid = 1; // live query id generator
    // qid -> live query object. keys:
    //  ordered: bool. ordered queries have addedBefore/movedBefore callbacks.
    //  results: array (ordered) or object (unordered) of current results
    //    (aliased with this._docs!)
    //  resultsSnapshot: snapshot of results. null if not paused.
    //  cursor: Cursor object for the query.
    //  selector, sorter, (callbacks): functions

    this.queries = Object.create(null); // null if not saving originals; an IdMap from id to original document value
    // if saving originals. See comments before saveOriginals().

    this._savedOriginals = null; // True when observers are paused and we should not send callbacks.

    this.paused = false;
  } // options may include sort, skip, limit, reactive
  // sort may be any of these forms:
  //     {a: 1, b: -1}
  //     [["a", "asc"], ["b", "desc"]]
  //     ["a", ["b", "desc"]]
  //   (in the first form you're beholden to key enumeration order in
  //   your javascript VM)
  //
  // reactive: if given, and false, don't register with Tracker (default
  // is true)
  //
  // XXX possibly should support retrieving a subset of fields? and
  // have it be a hint (ignored on the client, when not copying the
  // doc?)
  //
  // XXX sort does not yet support subkeys ('a.b') .. fix that!
  // XXX add one more sort form: "key"
  // XXX tests


  find(selector, options) {
    // default syntax for everything is to omit the selector argument.
    // but if selector is explicitly passed in as false or undefined, we
    // want a selector that matches nothing.
    if (arguments.length === 0) {
      selector = {};
    }

    return new LocalCollection.Cursor(this, selector, options);
  }

  findOne(selector, options = {}) {
    if (arguments.length === 0) {
      selector = {};
    } // NOTE: by setting limit 1 here, we end up using very inefficient
    // code that recomputes the whole query on each update. The upside is
    // that when you reactively depend on a findOne you only get
    // invalidated when the found object changes, not any object in the
    // collection. Most findOne will be by id, which has a fast path, so
    // this might not be a big deal. In most cases, invalidation causes
    // the called to re-query anyway, so this should be a net performance
    // improvement.


    options.limit = 1;
    return this.find(selector, options).fetch()[0];
  } // XXX possibly enforce that 'undefined' does not appear (we assume
  // this in our handling of null and $exists)


  insert(doc, callback) {
    doc = EJSON.clone(doc);
    assertHasValidFieldNames(doc); // if you really want to use ObjectIDs, set this global.
    // Mongo.Collection specifies its own ids and does not use this code.

    if (!hasOwn.call(doc, '_id')) {
      doc._id = LocalCollection._useOID ? new MongoID.ObjectID() : Random.id();
    }

    const id = doc._id;

    if (this._docs.has(id)) {
      throw MinimongoError(`Duplicate _id '${id}'`);
    }

    this._saveOriginal(id, undefined);

    this._docs.set(id, doc);

    const queriesToRecompute = []; // trigger live queries that match

    Object.keys(this.queries).forEach(qid => {
      const query = this.queries[qid];

      if (query.dirty) {
        return;
      }

      const matchResult = query.matcher.documentMatches(doc);

      if (matchResult.result) {
        if (query.distances && matchResult.distance !== undefined) {
          query.distances.set(id, matchResult.distance);
        }

        if (query.cursor.skip || query.cursor.limit) {
          queriesToRecompute.push(qid);
        } else {
          LocalCollection._insertInResults(query, doc);
        }
      }
    });
    queriesToRecompute.forEach(qid => {
      if (this.queries[qid]) {
        this._recomputeResults(this.queries[qid]);
      }
    });

    this._observeQueue.drain(); // Defer because the caller likely doesn't expect the callback to be run
    // immediately.


    if (callback) {
      Meteor.defer(() => {
        callback(null, id);
      });
    }

    return id;
  } // Pause the observers. No callbacks from observers will fire until
  // 'resumeObservers' is called.


  pauseObservers() {
    // No-op if already paused.
    if (this.paused) {
      return;
    } // Set the 'paused' flag such that new observer messages don't fire.


    this.paused = true; // Take a snapshot of the query results for each query.

    Object.keys(this.queries).forEach(qid => {
      const query = this.queries[qid];
      query.resultsSnapshot = EJSON.clone(query.results);
    });
  }

  remove(selector, callback) {
    // Easy special case: if we're not calling observeChanges callbacks and
    // we're not saving originals and we got asked to remove everything, then
    // just empty everything directly.
    if (this.paused && !this._savedOriginals && EJSON.equals(selector, {})) {
      const result = this._docs.size();

      this._docs.clear();

      Object.keys(this.queries).forEach(qid => {
        const query = this.queries[qid];

        if (query.ordered) {
          query.results = [];
        } else {
          query.results.clear();
        }
      });

      if (callback) {
        Meteor.defer(() => {
          callback(null, result);
        });
      }

      return result;
    }

    const matcher = new Minimongo.Matcher(selector);
    const remove = [];

    this._eachPossiblyMatchingDoc(selector, (doc, id) => {
      if (matcher.documentMatches(doc).result) {
        remove.push(id);
      }
    });

    const queriesToRecompute = [];
    const queryRemove = [];

    for (let i = 0; i < remove.length; i++) {
      const removeId = remove[i];

      const removeDoc = this._docs.get(removeId);

      Object.keys(this.queries).forEach(qid => {
        const query = this.queries[qid];

        if (query.dirty) {
          return;
        }

        if (query.matcher.documentMatches(removeDoc).result) {
          if (query.cursor.skip || query.cursor.limit) {
            queriesToRecompute.push(qid);
          } else {
            queryRemove.push({
              qid,
              doc: removeDoc
            });
          }
        }
      });

      this._saveOriginal(removeId, removeDoc);

      this._docs.remove(removeId);
    } // run live query callbacks _after_ we've removed the documents.


    queryRemove.forEach(remove => {
      const query = this.queries[remove.qid];

      if (query) {
        query.distances && query.distances.remove(remove.doc._id);

        LocalCollection._removeFromResults(query, remove.doc);
      }
    });
    queriesToRecompute.forEach(qid => {
      const query = this.queries[qid];

      if (query) {
        this._recomputeResults(query);
      }
    });

    this._observeQueue.drain();

    const result = remove.length;

    if (callback) {
      Meteor.defer(() => {
        callback(null, result);
      });
    }

    return result;
  } // Resume the observers. Observers immediately receive change
  // notifications to bring them to the current state of the
  // database. Note that this is not just replaying all the changes that
  // happened during the pause, it is a smarter 'coalesced' diff.


  resumeObservers() {
    // No-op if not paused.
    if (!this.paused) {
      return;
    } // Unset the 'paused' flag. Make sure to do this first, otherwise
    // observer methods won't actually fire when we trigger them.


    this.paused = false;
    Object.keys(this.queries).forEach(qid => {
      const query = this.queries[qid];

      if (query.dirty) {
        query.dirty = false; // re-compute results will perform `LocalCollection._diffQueryChanges`
        // automatically.

        this._recomputeResults(query, query.resultsSnapshot);
      } else {
        // Diff the current results against the snapshot and send to observers.
        // pass the query object for its observer callbacks.
        LocalCollection._diffQueryChanges(query.ordered, query.resultsSnapshot, query.results, query, {
          projectionFn: query.projectionFn
        });
      }

      query.resultsSnapshot = null;
    });

    this._observeQueue.drain();
  }

  retrieveOriginals() {
    if (!this._savedOriginals) {
      throw new Error('Called retrieveOriginals without saveOriginals');
    }

    const originals = this._savedOriginals;
    this._savedOriginals = null;
    return originals;
  } // To track what documents are affected by a piece of code, call
  // saveOriginals() before it and retrieveOriginals() after it.
  // retrieveOriginals returns an object whose keys are the ids of the documents
  // that were affected since the call to saveOriginals(), and the values are
  // equal to the document's contents at the time of saveOriginals. (In the case
  // of an inserted document, undefined is the value.) You must alternate
  // between calls to saveOriginals() and retrieveOriginals().


  saveOriginals() {
    if (this._savedOriginals) {
      throw new Error('Called saveOriginals twice without retrieveOriginals');
    }

    this._savedOriginals = new LocalCollection._IdMap();
  } // XXX atomicity: if multi is true, and one modification fails, do
  // we rollback the whole operation, or what?


  update(selector, mod, options, callback) {
    if (!callback && options instanceof Function) {
      callback = options;
      options = null;
    }

    if (!options) {
      options = {};
    }

    const matcher = new Minimongo.Matcher(selector, true); // Save the original results of any query that we might need to
    // _recomputeResults on, because _modifyAndNotify will mutate the objects in
    // it. (We don't need to save the original results of paused queries because
    // they already have a resultsSnapshot and we won't be diffing in
    // _recomputeResults.)

    const qidToOriginalResults = {}; // We should only clone each document once, even if it appears in multiple
    // queries

    const docMap = new LocalCollection._IdMap();

    const idsMatched = LocalCollection._idsMatchedBySelector(selector);

    Object.keys(this.queries).forEach(qid => {
      const query = this.queries[qid];

      if ((query.cursor.skip || query.cursor.limit) && !this.paused) {
        // Catch the case of a reactive `count()` on a cursor with skip
        // or limit, which registers an unordered observe. This is a
        // pretty rare case, so we just clone the entire result set with
        // no optimizations for documents that appear in these result
        // sets and other queries.
        if (query.results instanceof LocalCollection._IdMap) {
          qidToOriginalResults[qid] = query.results.clone();
          return;
        }

        if (!(query.results instanceof Array)) {
          throw new Error('Assertion failed: query.results not an array');
        } // Clones a document to be stored in `qidToOriginalResults`
        // because it may be modified before the new and old result sets
        // are diffed. But if we know exactly which document IDs we're
        // going to modify, then we only need to clone those.


        const memoizedCloneIfNeeded = doc => {
          if (docMap.has(doc._id)) {
            return docMap.get(doc._id);
          }

          const docToMemoize = idsMatched && !idsMatched.some(id => EJSON.equals(id, doc._id)) ? doc : EJSON.clone(doc);
          docMap.set(doc._id, docToMemoize);
          return docToMemoize;
        };

        qidToOriginalResults[qid] = query.results.map(memoizedCloneIfNeeded);
      }
    });
    const recomputeQids = {};
    let updateCount = 0;

    this._eachPossiblyMatchingDoc(selector, (doc, id) => {
      const queryResult = matcher.documentMatches(doc);

      if (queryResult.result) {
        // XXX Should we save the original even if mod ends up being a no-op?
        this._saveOriginal(id, doc);

        this._modifyAndNotify(doc, mod, recomputeQids, queryResult.arrayIndices);

        ++updateCount;

        if (!options.multi) {
          return false; // break
        }
      }

      return true;
    });

    Object.keys(recomputeQids).forEach(qid => {
      const query = this.queries[qid];

      if (query) {
        this._recomputeResults(query, qidToOriginalResults[qid]);
      }
    });

    this._observeQueue.drain(); // If we are doing an upsert, and we didn't modify any documents yet, then
    // it's time to do an insert. Figure out what document we are inserting, and
    // generate an id for it.


    let insertedId;

    if (updateCount === 0 && options.upsert) {
      const doc = LocalCollection._createUpsertDocument(selector, mod);

      if (!doc._id && options.insertedId) {
        doc._id = options.insertedId;
      }

      insertedId = this.insert(doc);
      updateCount = 1;
    } // Return the number of affected documents, or in the upsert case, an object
    // containing the number of affected docs and the id of the doc that was
    // inserted, if any.


    let result;

    if (options._returnObject) {
      result = {
        numberAffected: updateCount
      };

      if (insertedId !== undefined) {
        result.insertedId = insertedId;
      }
    } else {
      result = updateCount;
    }

    if (callback) {
      Meteor.defer(() => {
        callback(null, result);
      });
    }

    return result;
  } // A convenience wrapper on update. LocalCollection.upsert(sel, mod) is
  // equivalent to LocalCollection.update(sel, mod, {upsert: true,
  // _returnObject: true}).


  upsert(selector, mod, options, callback) {
    if (!callback && typeof options === 'function') {
      callback = options;
      options = {};
    }

    return this.update(selector, mod, Object.assign({}, options, {
      upsert: true,
      _returnObject: true
    }), callback);
  } // Iterates over a subset of documents that could match selector; calls
  // fn(doc, id) on each of them.  Specifically, if selector specifies
  // specific _id's, it only looks at those.  doc is *not* cloned: it is the
  // same object that is in _docs.


  _eachPossiblyMatchingDoc(selector, fn) {
    const specificIds = LocalCollection._idsMatchedBySelector(selector);

    if (specificIds) {
      specificIds.some(id => {
        const doc = this._docs.get(id);

        if (doc) {
          return fn(doc, id) === false;
        }
      });
    } else {
      this._docs.forEach(fn);
    }
  }

  _modifyAndNotify(doc, mod, recomputeQids, arrayIndices) {
    const matched_before = {};
    Object.keys(this.queries).forEach(qid => {
      const query = this.queries[qid];

      if (query.dirty) {
        return;
      }

      if (query.ordered) {
        matched_before[qid] = query.matcher.documentMatches(doc).result;
      } else {
        // Because we don't support skip or limit (yet) in unordered queries, we
        // can just do a direct lookup.
        matched_before[qid] = query.results.has(doc._id);
      }
    });
    const old_doc = EJSON.clone(doc);

    LocalCollection._modify(doc, mod, {
      arrayIndices
    });

    Object.keys(this.queries).forEach(qid => {
      const query = this.queries[qid];

      if (query.dirty) {
        return;
      }

      const afterMatch = query.matcher.documentMatches(doc);
      const after = afterMatch.result;
      const before = matched_before[qid];

      if (after && query.distances && afterMatch.distance !== undefined) {
        query.distances.set(doc._id, afterMatch.distance);
      }

      if (query.cursor.skip || query.cursor.limit) {
        // We need to recompute any query where the doc may have been in the
        // cursor's window either before or after the update. (Note that if skip
        // or limit is set, "before" and "after" being true do not necessarily
        // mean that the document is in the cursor's output after skip/limit is
        // applied... but if they are false, then the document definitely is NOT
        // in the output. So it's safe to skip recompute if neither before or
        // after are true.)
        if (before || after) {
          recomputeQids[qid] = true;
        }
      } else if (before && !after) {
        LocalCollection._removeFromResults(query, doc);
      } else if (!before && after) {
        LocalCollection._insertInResults(query, doc);
      } else if (before && after) {
        LocalCollection._updateInResults(query, doc, old_doc);
      }
    });
  } // Recomputes the results of a query and runs observe callbacks for the
  // difference between the previous results and the current results (unless
  // paused). Used for skip/limit queries.
  //
  // When this is used by insert or remove, it can just use query.results for
  // the old results (and there's no need to pass in oldResults), because these
  // operations don't mutate the documents in the collection. Update needs to
  // pass in an oldResults which was deep-copied before the modifier was
  // applied.
  //
  // oldResults is guaranteed to be ignored if the query is not paused.


  _recomputeResults(query, oldResults) {
    if (this.paused) {
      // There's no reason to recompute the results now as we're still paused.
      // By flagging the query as "dirty", the recompute will be performed
      // when resumeObservers is called.
      query.dirty = true;
      return;
    }

    if (!this.paused && !oldResults) {
      oldResults = query.results;
    }

    if (query.distances) {
      query.distances.clear();
    }

    query.results = query.cursor._getRawObjects({
      distances: query.distances,
      ordered: query.ordered
    });

    if (!this.paused) {
      LocalCollection._diffQueryChanges(query.ordered, oldResults, query.results, query, {
        projectionFn: query.projectionFn
      });
    }
  }

  _saveOriginal(id, doc) {
    // Are we even trying to save originals?
    if (!this._savedOriginals) {
      return;
    } // Have we previously mutated the original (and so 'doc' is not actually
    // original)?  (Note the 'has' check rather than truth: we store undefined
    // here for inserted docs!)


    if (this._savedOriginals.has(id)) {
      return;
    }

    this._savedOriginals.set(id, EJSON.clone(doc));
  }

}

LocalCollection.Cursor = Cursor;
LocalCollection.ObserveHandle = ObserveHandle; // XXX maybe move these into another ObserveHelpers package or something
// _CachingChangeObserver is an object which receives observeChanges callbacks
// and keeps a cache of the current cursor state up to date in this.docs. Users
// of this class should read the docs field but not modify it. You should pass
// the "applyChange" field as the callbacks to the underlying observeChanges
// call. Optionally, you can specify your own observeChanges callbacks which are
// invoked immediately before the docs field is updated; this object is made
// available as `this` to those callbacks.

LocalCollection._CachingChangeObserver = class _CachingChangeObserver {
  constructor(options = {}) {
    const orderedFromCallbacks = options.callbacks && LocalCollection._observeChangesCallbacksAreOrdered(options.callbacks);

    if (hasOwn.call(options, 'ordered')) {
      this.ordered = options.ordered;

      if (options.callbacks && options.ordered !== orderedFromCallbacks) {
        throw Error('ordered option doesn\'t match callbacks');
      }
    } else if (options.callbacks) {
      this.ordered = orderedFromCallbacks;
    } else {
      throw Error('must provide ordered or callbacks');
    }

    const callbacks = options.callbacks || {};

    if (this.ordered) {
      this.docs = new OrderedDict(MongoID.idStringify);
      this.applyChange = {
        addedBefore: (id, fields, before) => {
          const doc = EJSON.clone(fields);
          doc._id = id;

          if (callbacks.addedBefore) {
            callbacks.addedBefore.call(this, id, fields, before);
          } // This line triggers if we provide added with movedBefore.


          if (callbacks.added) {
            callbacks.added.call(this, id, fields);
          } // XXX could `before` be a falsy ID?  Technically
          // idStringify seems to allow for them -- though
          // OrderedDict won't call stringify on a falsy arg.


          this.docs.putBefore(id, doc, before || null);
        },
        movedBefore: (id, before) => {
          const doc = this.docs.get(id);

          if (callbacks.movedBefore) {
            callbacks.movedBefore.call(this, id, before);
          }

          this.docs.moveBefore(id, before || null);
        }
      };
    } else {
      this.docs = new LocalCollection._IdMap();
      this.applyChange = {
        added: (id, fields) => {
          const doc = EJSON.clone(fields);

          if (callbacks.added) {
            callbacks.added.call(this, id, fields);
          }

          doc._id = id;
          this.docs.set(id, doc);
        }
      };
    } // The methods in _IdMap and OrderedDict used by these callbacks are
    // identical.


    this.applyChange.changed = (id, fields) => {
      const doc = this.docs.get(id);

      if (!doc) {
        throw new Error(`Unknown id for changed: ${id}`);
      }

      if (callbacks.changed) {
        callbacks.changed.call(this, id, EJSON.clone(fields));
      }

      DiffSequence.applyChanges(doc, fields);
    };

    this.applyChange.removed = id => {
      if (callbacks.removed) {
        callbacks.removed.call(this, id);
      }

      this.docs.remove(id);
    };
  }

};
LocalCollection._IdMap = class _IdMap extends IdMap {
  constructor() {
    super(MongoID.idStringify, MongoID.idParse);
  }

}; // Wrap a transform function to return objects that have the _id field
// of the untransformed document. This ensures that subsystems such as
// the observe-sequence package that call `observe` can keep track of
// the documents identities.
//
// - Require that it returns objects
// - If the return value has an _id field, verify that it matches the
//   original _id field
// - If the return value doesn't have an _id field, add it back.

LocalCollection.wrapTransform = transform => {
  if (!transform) {
    return null;
  } // No need to doubly-wrap transforms.


  if (transform.__wrappedTransform__) {
    return transform;
  }

  const wrapped = doc => {
    if (!hasOwn.call(doc, '_id')) {
      // XXX do we ever have a transform on the oplog's collection? because that
      // collection has no _id.
      throw new Error('can only transform documents with _id');
    }

    const id = doc._id; // XXX consider making tracker a weak dependency and checking
    // Package.tracker here

    const transformed = Tracker.nonreactive(() => transform(doc));

    if (!LocalCollection._isPlainObject(transformed)) {
      throw new Error('transform must return object');
    }

    if (hasOwn.call(transformed, '_id')) {
      if (!EJSON.equals(transformed._id, id)) {
        throw new Error('transformed document can\'t have different _id');
      }
    } else {
      transformed._id = id;
    }

    return transformed;
  };

  wrapped.__wrappedTransform__ = true;
  return wrapped;
}; // XXX the sorted-query logic below is laughably inefficient. we'll
// need to come up with a better datastructure for this.
//
// XXX the logic for observing with a skip or a limit is even more
// laughably inefficient. we recompute the whole results every time!
// This binary search puts a value between any equal values, and the first
// lesser value.


LocalCollection._binarySearch = (cmp, array, value) => {
  let first = 0;
  let range = array.length;

  while (range > 0) {
    const halfRange = Math.floor(range / 2);

    if (cmp(value, array[first + halfRange]) >= 0) {
      first += halfRange + 1;
      range -= halfRange + 1;
    } else {
      range = halfRange;
    }
  }

  return first;
};

LocalCollection._checkSupportedProjection = fields => {
  if (fields !== Object(fields) || Array.isArray(fields)) {
    throw MinimongoError('fields option must be an object');
  }

  Object.keys(fields).forEach(keyPath => {
    if (keyPath.split('.').includes('$')) {
      throw MinimongoError('Minimongo doesn\'t support $ operator in projections yet.');
    }

    const value = fields[keyPath];

    if (typeof value === 'object' && ['$elemMatch', '$meta', '$slice'].some(key => hasOwn.call(value, key))) {
      throw MinimongoError('Minimongo doesn\'t support operators in projections yet.');
    }

    if (![1, 0, true, false].includes(value)) {
      throw MinimongoError('Projection values should be one of 1, 0, true, or false');
    }
  });
}; // Knows how to compile a fields projection to a predicate function.
// @returns - Function: a closure that filters out an object according to the
//            fields projection rules:
//            @param obj - Object: MongoDB-styled document
//            @returns - Object: a document with the fields filtered out
//                       according to projection rules. Doesn't retain subfields
//                       of passed argument.


LocalCollection._compileProjection = fields => {
  LocalCollection._checkSupportedProjection(fields);

  const _idProjection = fields._id === undefined ? true : fields._id;

  const details = projectionDetails(fields); // returns transformed doc according to ruleTree

  const transform = (doc, ruleTree) => {
    // Special case for "sets"
    if (Array.isArray(doc)) {
      return doc.map(subdoc => transform(subdoc, ruleTree));
    }

    const result = details.including ? {} : EJSON.clone(doc);
    Object.keys(ruleTree).forEach(key => {
      if (!hasOwn.call(doc, key)) {
        return;
      }

      const rule = ruleTree[key];

      if (rule === Object(rule)) {
        // For sub-objects/subsets we branch
        if (doc[key] === Object(doc[key])) {
          result[key] = transform(doc[key], rule);
        }
      } else if (details.including) {
        // Otherwise we don't even touch this subfield
        result[key] = EJSON.clone(doc[key]);
      } else {
        delete result[key];
      }
    });
    return result;
  };

  return doc => {
    const result = transform(doc, details.tree);

    if (_idProjection && hasOwn.call(doc, '_id')) {
      result._id = doc._id;
    }

    if (!_idProjection && hasOwn.call(result, '_id')) {
      delete result._id;
    }

    return result;
  };
}; // Calculates the document to insert in case we're doing an upsert and the
// selector does not match any elements


LocalCollection._createUpsertDocument = (selector, modifier) => {
  const selectorDocument = populateDocumentWithQueryFields(selector);

  const isModify = LocalCollection._isModificationMod(modifier);

  const newDoc = {};

  if (selectorDocument._id) {
    newDoc._id = selectorDocument._id;
    delete selectorDocument._id;
  } // This double _modify call is made to help with nested properties (see issue
  // #8631). We do this even if it's a replacement for validation purposes (e.g.
  // ambiguous id's)


  LocalCollection._modify(newDoc, {
    $set: selectorDocument
  });

  LocalCollection._modify(newDoc, modifier, {
    isInsert: true
  });

  if (isModify) {
    return newDoc;
  } // Replacement can take _id from query document


  const replacement = Object.assign({}, modifier);

  if (newDoc._id) {
    replacement._id = newDoc._id;
  }

  return replacement;
};

LocalCollection._diffObjects = (left, right, callbacks) => {
  return DiffSequence.diffObjects(left, right, callbacks);
}; // ordered: bool.
// old_results and new_results: collections of documents.
//    if ordered, they are arrays.
//    if unordered, they are IdMaps


LocalCollection._diffQueryChanges = (ordered, oldResults, newResults, observer, options) => DiffSequence.diffQueryChanges(ordered, oldResults, newResults, observer, options);

LocalCollection._diffQueryOrderedChanges = (oldResults, newResults, observer, options) => DiffSequence.diffQueryOrderedChanges(oldResults, newResults, observer, options);

LocalCollection._diffQueryUnorderedChanges = (oldResults, newResults, observer, options) => DiffSequence.diffQueryUnorderedChanges(oldResults, newResults, observer, options);

LocalCollection._findInOrderedResults = (query, doc) => {
  if (!query.ordered) {
    throw new Error('Can\'t call _findInOrderedResults on unordered query');
  }

  for (let i = 0; i < query.results.length; i++) {
    if (query.results[i] === doc) {
      return i;
    }
  }

  throw Error('object missing from query');
}; // If this is a selector which explicitly constrains the match by ID to a finite
// number of documents, returns a list of their IDs.  Otherwise returns
// null. Note that the selector may have other restrictions so it may not even
// match those document!  We care about $in and $and since those are generated
// access-controlled update and remove.


LocalCollection._idsMatchedBySelector = selector => {
  // Is the selector just an ID?
  if (LocalCollection._selectorIsId(selector)) {
    return [selector];
  }

  if (!selector) {
    return null;
  } // Do we have an _id clause?


  if (hasOwn.call(selector, '_id')) {
    // Is the _id clause just an ID?
    if (LocalCollection._selectorIsId(selector._id)) {
      return [selector._id];
    } // Is the _id clause {_id: {$in: ["x", "y", "z"]}}?


    if (selector._id && Array.isArray(selector._id.$in) && selector._id.$in.length && selector._id.$in.every(LocalCollection._selectorIsId)) {
      return selector._id.$in;
    }

    return null;
  } // If this is a top-level $and, and any of the clauses constrain their
  // documents, then the whole selector is constrained by any one clause's
  // constraint. (Well, by their intersection, but that seems unlikely.)


  if (Array.isArray(selector.$and)) {
    for (let i = 0; i < selector.$and.length; ++i) {
      const subIds = LocalCollection._idsMatchedBySelector(selector.$and[i]);

      if (subIds) {
        return subIds;
      }
    }
  }

  return null;
};

LocalCollection._insertInResults = (query, doc) => {
  const fields = EJSON.clone(doc);
  delete fields._id;

  if (query.ordered) {
    if (!query.sorter) {
      query.addedBefore(doc._id, query.projectionFn(fields), null);
      query.results.push(doc);
    } else {
      const i = LocalCollection._insertInSortedList(query.sorter.getComparator({
        distances: query.distances
      }), query.results, doc);

      let next = query.results[i + 1];

      if (next) {
        next = next._id;
      } else {
        next = null;
      }

      query.addedBefore(doc._id, query.projectionFn(fields), next);
    }

    query.added(doc._id, query.projectionFn(fields));
  } else {
    query.added(doc._id, query.projectionFn(fields));
    query.results.set(doc._id, doc);
  }
};

LocalCollection._insertInSortedList = (cmp, array, value) => {
  if (array.length === 0) {
    array.push(value);
    return 0;
  }

  const i = LocalCollection._binarySearch(cmp, array, value);

  array.splice(i, 0, value);
  return i;
};

LocalCollection._isModificationMod = mod => {
  let isModify = false;
  let isReplace = false;
  Object.keys(mod).forEach(key => {
    if (key.substr(0, 1) === '$') {
      isModify = true;
    } else {
      isReplace = true;
    }
  });

  if (isModify && isReplace) {
    throw new Error('Update parameter cannot have both modifier and non-modifier fields.');
  }

  return isModify;
}; // XXX maybe this should be EJSON.isObject, though EJSON doesn't know about
// RegExp
// XXX note that _type(undefined) === 3!!!!


LocalCollection._isPlainObject = x => {
  return x && LocalCollection._f._type(x) === 3;
}; // XXX need a strategy for passing the binding of $ into this
// function, from the compiled selector
//
// maybe just {key.up.to.just.before.dollarsign: array_index}
//
// XXX atomicity: if one modification fails, do we roll back the whole
// change?
//
// options:
//   - isInsert is set when _modify is being called to compute the document to
//     insert as part of an upsert operation. We use this primarily to figure
//     out when to set the fields in $setOnInsert, if present.


LocalCollection._modify = (doc, modifier, options = {}) => {
  if (!LocalCollection._isPlainObject(modifier)) {
    throw MinimongoError('Modifier must be an object');
  } // Make sure the caller can't mutate our data structures.


  modifier = EJSON.clone(modifier);
  const isModifier = isOperatorObject(modifier);
  const newDoc = isModifier ? EJSON.clone(doc) : modifier;

  if (isModifier) {
    // apply modifiers to the doc.
    Object.keys(modifier).forEach(operator => {
      // Treat $setOnInsert as $set if this is an insert.
      const setOnInsert = options.isInsert && operator === '$setOnInsert';
      const modFunc = MODIFIERS[setOnInsert ? '$set' : operator];
      const operand = modifier[operator];

      if (!modFunc) {
        throw MinimongoError(`Invalid modifier specified ${operator}`);
      }

      Object.keys(operand).forEach(keypath => {
        const arg = operand[keypath];

        if (keypath === '') {
          throw MinimongoError('An empty update path is not valid.');
        }

        const keyparts = keypath.split('.');

        if (!keyparts.every(Boolean)) {
          throw MinimongoError(`The update path '${keypath}' contains an empty field name, ` + 'which is not allowed.');
        }

        const target = findModTarget(newDoc, keyparts, {
          arrayIndices: options.arrayIndices,
          forbidArray: operator === '$rename',
          noCreate: NO_CREATE_MODIFIERS[operator]
        });
        modFunc(target, keyparts.pop(), arg, keypath, newDoc);
      });
    });

    if (doc._id && !EJSON.equals(doc._id, newDoc._id)) {
      throw MinimongoError(`After applying the update to the document {_id: "${doc._id}", ...},` + ' the (immutable) field \'_id\' was found to have been altered to ' + `_id: "${newDoc._id}"`);
    }
  } else {
    if (doc._id && modifier._id && !EJSON.equals(doc._id, modifier._id)) {
      throw MinimongoError(`The _id field cannot be changed from {_id: "${doc._id}"} to ` + `{_id: "${modifier._id}"}`);
    } // replace the whole document


    assertHasValidFieldNames(modifier);
  } // move new document into place.


  Object.keys(doc).forEach(key => {
    // Note: this used to be for (var key in doc) however, this does not
    // work right in Opera. Deleting from a doc while iterating over it
    // would sometimes cause opera to skip some keys.
    if (key !== '_id') {
      delete doc[key];
    }
  });
  Object.keys(newDoc).forEach(key => {
    doc[key] = newDoc[key];
  });
};

LocalCollection._observeFromObserveChanges = (cursor, observeCallbacks) => {
  const transform = cursor.getTransform() || (doc => doc);

  let suppressed = !!observeCallbacks._suppress_initial;
  let observeChangesCallbacks;

  if (LocalCollection._observeCallbacksAreOrdered(observeCallbacks)) {
    // The "_no_indices" option sets all index arguments to -1 and skips the
    // linear scans required to generate them.  This lets observers that don't
    // need absolute indices benefit from the other features of this API --
    // relative order, transforms, and applyChanges -- without the speed hit.
    const indices = !observeCallbacks._no_indices;
    observeChangesCallbacks = {
      addedBefore(id, fields, before) {
        if (suppressed || !(observeCallbacks.addedAt || observeCallbacks.added)) {
          return;
        }

        const doc = transform(Object.assign(fields, {
          _id: id
        }));

        if (observeCallbacks.addedAt) {
          observeCallbacks.addedAt(doc, indices ? before ? this.docs.indexOf(before) : this.docs.size() : -1, before);
        } else {
          observeCallbacks.added(doc);
        }
      },

      changed(id, fields) {
        if (!(observeCallbacks.changedAt || observeCallbacks.changed)) {
          return;
        }

        let doc = EJSON.clone(this.docs.get(id));

        if (!doc) {
          throw new Error(`Unknown id for changed: ${id}`);
        }

        const oldDoc = transform(EJSON.clone(doc));
        DiffSequence.applyChanges(doc, fields);

        if (observeCallbacks.changedAt) {
          observeCallbacks.changedAt(transform(doc), oldDoc, indices ? this.docs.indexOf(id) : -1);
        } else {
          observeCallbacks.changed(transform(doc), oldDoc);
        }
      },

      movedBefore(id, before) {
        if (!observeCallbacks.movedTo) {
          return;
        }

        const from = indices ? this.docs.indexOf(id) : -1;
        let to = indices ? before ? this.docs.indexOf(before) : this.docs.size() : -1; // When not moving backwards, adjust for the fact that removing the
        // document slides everything back one slot.

        if (to > from) {
          --to;
        }

        observeCallbacks.movedTo(transform(EJSON.clone(this.docs.get(id))), from, to, before || null);
      },

      removed(id) {
        if (!(observeCallbacks.removedAt || observeCallbacks.removed)) {
          return;
        } // technically maybe there should be an EJSON.clone here, but it's about
        // to be removed from this.docs!


        const doc = transform(this.docs.get(id));

        if (observeCallbacks.removedAt) {
          observeCallbacks.removedAt(doc, indices ? this.docs.indexOf(id) : -1);
        } else {
          observeCallbacks.removed(doc);
        }
      }

    };
  } else {
    observeChangesCallbacks = {
      added(id, fields) {
        if (!suppressed && observeCallbacks.added) {
          observeCallbacks.added(transform(Object.assign(fields, {
            _id: id
          })));
        }
      },

      changed(id, fields) {
        if (observeCallbacks.changed) {
          const oldDoc = this.docs.get(id);
          const doc = EJSON.clone(oldDoc);
          DiffSequence.applyChanges(doc, fields);
          observeCallbacks.changed(transform(doc), transform(EJSON.clone(oldDoc)));
        }
      },

      removed(id) {
        if (observeCallbacks.removed) {
          observeCallbacks.removed(transform(this.docs.get(id)));
        }
      }

    };
  }

  const changeObserver = new LocalCollection._CachingChangeObserver({
    callbacks: observeChangesCallbacks
  });
  const handle = cursor.observeChanges(changeObserver.applyChange);
  suppressed = false;
  return handle;
};

LocalCollection._observeCallbacksAreOrdered = callbacks => {
  if (callbacks.added && callbacks.addedAt) {
    throw new Error('Please specify only one of added() and addedAt()');
  }

  if (callbacks.changed && callbacks.changedAt) {
    throw new Error('Please specify only one of changed() and changedAt()');
  }

  if (callbacks.removed && callbacks.removedAt) {
    throw new Error('Please specify only one of removed() and removedAt()');
  }

  return !!(callbacks.addedAt || callbacks.changedAt || callbacks.movedTo || callbacks.removedAt);
};

LocalCollection._observeChangesCallbacksAreOrdered = callbacks => {
  if (callbacks.added && callbacks.addedBefore) {
    throw new Error('Please specify only one of added() and addedBefore()');
  }

  return !!(callbacks.addedBefore || callbacks.movedBefore);
};

LocalCollection._removeFromResults = (query, doc) => {
  if (query.ordered) {
    const i = LocalCollection._findInOrderedResults(query, doc);

    query.removed(doc._id);
    query.results.splice(i, 1);
  } else {
    const id = doc._id; // in case callback mutates doc

    query.removed(doc._id);
    query.results.remove(id);
  }
}; // Is this selector just shorthand for lookup by _id?


LocalCollection._selectorIsId = selector => typeof selector === 'number' || typeof selector === 'string' || selector instanceof MongoID.ObjectID; // Is the selector just lookup by _id (shorthand or not)?


LocalCollection._selectorIsIdPerhapsAsObject = selector => LocalCollection._selectorIsId(selector) || LocalCollection._selectorIsId(selector && selector._id) && Object.keys(selector).length === 1;

LocalCollection._updateInResults = (query, doc, old_doc) => {
  if (!EJSON.equals(doc._id, old_doc._id)) {
    throw new Error('Can\'t change a doc\'s _id while updating');
  }

  const projectionFn = query.projectionFn;
  const changedFields = DiffSequence.makeChangedFields(projectionFn(doc), projectionFn(old_doc));

  if (!query.ordered) {
    if (Object.keys(changedFields).length) {
      query.changed(doc._id, changedFields);
      query.results.set(doc._id, doc);
    }

    return;
  }

  const old_idx = LocalCollection._findInOrderedResults(query, doc);

  if (Object.keys(changedFields).length) {
    query.changed(doc._id, changedFields);
  }

  if (!query.sorter) {
    return;
  } // just take it out and put it back in again, and see if the index changes


  query.results.splice(old_idx, 1);

  const new_idx = LocalCollection._insertInSortedList(query.sorter.getComparator({
    distances: query.distances
  }), query.results, doc);

  if (old_idx !== new_idx) {
    let next = query.results[new_idx + 1];

    if (next) {
      next = next._id;
    } else {
      next = null;
    }

    query.movedBefore && query.movedBefore(doc._id, next);
  }
};

const MODIFIERS = {
  $currentDate(target, field, arg) {
    if (typeof arg === 'object' && hasOwn.call(arg, '$type')) {
      if (arg.$type !== 'date') {
        throw MinimongoError('Minimongo does currently only support the date type in ' + '$currentDate modifiers', {
          field
        });
      }
    } else if (arg !== true) {
      throw MinimongoError('Invalid $currentDate modifier', {
        field
      });
    }

    target[field] = new Date();
  },

  $min(target, field, arg) {
    if (typeof arg !== 'number') {
      throw MinimongoError('Modifier $min allowed for numbers only', {
        field
      });
    }

    if (field in target) {
      if (typeof target[field] !== 'number') {
        throw MinimongoError('Cannot apply $min modifier to non-number', {
          field
        });
      }

      if (target[field] > arg) {
        target[field] = arg;
      }
    } else {
      target[field] = arg;
    }
  },

  $max(target, field, arg) {
    if (typeof arg !== 'number') {
      throw MinimongoError('Modifier $max allowed for numbers only', {
        field
      });
    }

    if (field in target) {
      if (typeof target[field] !== 'number') {
        throw MinimongoError('Cannot apply $max modifier to non-number', {
          field
        });
      }

      if (target[field] < arg) {
        target[field] = arg;
      }
    } else {
      target[field] = arg;
    }
  },

  $inc(target, field, arg) {
    if (typeof arg !== 'number') {
      throw MinimongoError('Modifier $inc allowed for numbers only', {
        field
      });
    }

    if (field in target) {
      if (typeof target[field] !== 'number') {
        throw MinimongoError('Cannot apply $inc modifier to non-number', {
          field
        });
      }

      target[field] += arg;
    } else {
      target[field] = arg;
    }
  },

  $set(target, field, arg) {
    if (target !== Object(target)) {
      // not an array or an object
      const error = MinimongoError('Cannot set property on non-object field', {
        field
      });
      error.setPropertyError = true;
      throw error;
    }

    if (target === null) {
      const error = MinimongoError('Cannot set property on null', {
        field
      });
      error.setPropertyError = true;
      throw error;
    }

    assertHasValidFieldNames(arg);
    target[field] = arg;
  },

  $setOnInsert(target, field, arg) {// converted to `$set` in `_modify`
  },

  $unset(target, field, arg) {
    if (target !== undefined) {
      if (target instanceof Array) {
        if (field in target) {
          target[field] = null;
        }
      } else {
        delete target[field];
      }
    }
  },

  $push(target, field, arg) {
    if (target[field] === undefined) {
      target[field] = [];
    }

    if (!(target[field] instanceof Array)) {
      throw MinimongoError('Cannot apply $push modifier to non-array', {
        field
      });
    }

    if (!(arg && arg.$each)) {
      // Simple mode: not $each
      assertHasValidFieldNames(arg);
      target[field].push(arg);
      return;
    } // Fancy mode: $each (and maybe $slice and $sort and $position)


    const toPush = arg.$each;

    if (!(toPush instanceof Array)) {
      throw MinimongoError('$each must be an array', {
        field
      });
    }

    assertHasValidFieldNames(toPush); // Parse $position

    let position = undefined;

    if ('$position' in arg) {
      if (typeof arg.$position !== 'number') {
        throw MinimongoError('$position must be a numeric value', {
          field
        });
      } // XXX should check to make sure integer


      if (arg.$position < 0) {
        throw MinimongoError('$position in $push must be zero or positive', {
          field
        });
      }

      position = arg.$position;
    } // Parse $slice.


    let slice = undefined;

    if ('$slice' in arg) {
      if (typeof arg.$slice !== 'number') {
        throw MinimongoError('$slice must be a numeric value', {
          field
        });
      } // XXX should check to make sure integer


      slice = arg.$slice;
    } // Parse $sort.


    let sortFunction = undefined;

    if (arg.$sort) {
      if (slice === undefined) {
        throw MinimongoError('$sort requires $slice to be present', {
          field
        });
      } // XXX this allows us to use a $sort whose value is an array, but that's
      // actually an extension of the Node driver, so it won't work
      // server-side. Could be confusing!
      // XXX is it correct that we don't do geo-stuff here?


      sortFunction = new Minimongo.Sorter(arg.$sort).getComparator();
      toPush.forEach(element => {
        if (LocalCollection._f._type(element) !== 3) {
          throw MinimongoError('$push like modifiers using $sort require all elements to be ' + 'objects', {
            field
          });
        }
      });
    } // Actually push.


    if (position === undefined) {
      toPush.forEach(element => {
        target[field].push(element);
      });
    } else {
      const spliceArguments = [position, 0];
      toPush.forEach(element => {
        spliceArguments.push(element);
      });
      target[field].splice(...spliceArguments);
    } // Actually sort.


    if (sortFunction) {
      target[field].sort(sortFunction);
    } // Actually slice.


    if (slice !== undefined) {
      if (slice === 0) {
        target[field] = []; // differs from Array.slice!
      } else if (slice < 0) {
        target[field] = target[field].slice(slice);
      } else {
        target[field] = target[field].slice(0, slice);
      }
    }
  },

  $pushAll(target, field, arg) {
    if (!(typeof arg === 'object' && arg instanceof Array)) {
      throw MinimongoError('Modifier $pushAll/pullAll allowed for arrays only');
    }

    assertHasValidFieldNames(arg);
    const toPush = target[field];

    if (toPush === undefined) {
      target[field] = arg;
    } else if (!(toPush instanceof Array)) {
      throw MinimongoError('Cannot apply $pushAll modifier to non-array', {
        field
      });
    } else {
      toPush.push(...arg);
    }
  },

  $addToSet(target, field, arg) {
    let isEach = false;

    if (typeof arg === 'object') {
      // check if first key is '$each'
      const keys = Object.keys(arg);

      if (keys[0] === '$each') {
        isEach = true;
      }
    }

    const values = isEach ? arg.$each : [arg];
    assertHasValidFieldNames(values);
    const toAdd = target[field];

    if (toAdd === undefined) {
      target[field] = values;
    } else if (!(toAdd instanceof Array)) {
      throw MinimongoError('Cannot apply $addToSet modifier to non-array', {
        field
      });
    } else {
      values.forEach(value => {
        if (toAdd.some(element => LocalCollection._f._equal(value, element))) {
          return;
        }

        toAdd.push(value);
      });
    }
  },

  $pop(target, field, arg) {
    if (target === undefined) {
      return;
    }

    const toPop = target[field];

    if (toPop === undefined) {
      return;
    }

    if (!(toPop instanceof Array)) {
      throw MinimongoError('Cannot apply $pop modifier to non-array', {
        field
      });
    }

    if (typeof arg === 'number' && arg < 0) {
      toPop.splice(0, 1);
    } else {
      toPop.pop();
    }
  },

  $pull(target, field, arg) {
    if (target === undefined) {
      return;
    }

    const toPull = target[field];

    if (toPull === undefined) {
      return;
    }

    if (!(toPull instanceof Array)) {
      throw MinimongoError('Cannot apply $pull/pullAll modifier to non-array', {
        field
      });
    }

    let out;

    if (arg != null && typeof arg === 'object' && !(arg instanceof Array)) {
      // XXX would be much nicer to compile this once, rather than
      // for each document we modify.. but usually we're not
      // modifying that many documents, so we'll let it slide for
      // now
      // XXX Minimongo.Matcher isn't up for the job, because we need
      // to permit stuff like {$pull: {a: {$gt: 4}}}.. something
      // like {$gt: 4} is not normally a complete selector.
      // same issue as $elemMatch possibly?
      const matcher = new Minimongo.Matcher(arg);
      out = toPull.filter(element => !matcher.documentMatches(element).result);
    } else {
      out = toPull.filter(element => !LocalCollection._f._equal(element, arg));
    }

    target[field] = out;
  },

  $pullAll(target, field, arg) {
    if (!(typeof arg === 'object' && arg instanceof Array)) {
      throw MinimongoError('Modifier $pushAll/pullAll allowed for arrays only', {
        field
      });
    }

    if (target === undefined) {
      return;
    }

    const toPull = target[field];

    if (toPull === undefined) {
      return;
    }

    if (!(toPull instanceof Array)) {
      throw MinimongoError('Cannot apply $pull/pullAll modifier to non-array', {
        field
      });
    }

    target[field] = toPull.filter(object => !arg.some(element => LocalCollection._f._equal(object, element)));
  },

  $rename(target, field, arg, keypath, doc) {
    // no idea why mongo has this restriction..
    if (keypath === arg) {
      throw MinimongoError('$rename source must differ from target', {
        field
      });
    }

    if (target === null) {
      throw MinimongoError('$rename source field invalid', {
        field
      });
    }

    if (typeof arg !== 'string') {
      throw MinimongoError('$rename target must be a string', {
        field
      });
    }

    if (arg.includes('\0')) {
      // Null bytes are not allowed in Mongo field names
      // https://docs.mongodb.com/manual/reference/limits/#Restrictions-on-Field-Names
      throw MinimongoError('The \'to\' field for $rename cannot contain an embedded null byte', {
        field
      });
    }

    if (target === undefined) {
      return;
    }

    const object = target[field];
    delete target[field];
    const keyparts = arg.split('.');
    const target2 = findModTarget(doc, keyparts, {
      forbidArray: true
    });

    if (target2 === null) {
      throw MinimongoError('$rename target field invalid', {
        field
      });
    }

    target2[keyparts.pop()] = object;
  },

  $bit(target, field, arg) {
    // XXX mongo only supports $bit on integers, and we only support
    // native javascript numbers (doubles) so far, so we can't support $bit
    throw MinimongoError('$bit is not supported', {
      field
    });
  }

};
const NO_CREATE_MODIFIERS = {
  $pop: true,
  $pull: true,
  $pullAll: true,
  $rename: true,
  $unset: true
}; // Make sure field names do not contain Mongo restricted
// characters ('.', '$', '\0').
// https://docs.mongodb.com/manual/reference/limits/#Restrictions-on-Field-Names

const invalidCharMsg = {
  $: 'start with \'$\'',
  '.': 'contain \'.\'',
  '\0': 'contain null bytes'
}; // checks if all field names in an object are valid

function assertHasValidFieldNames(doc) {
  if (doc && typeof doc === 'object') {
    JSON.stringify(doc, (key, value) => {
      assertIsValidFieldName(key);
      return value;
    });
  }
}

function assertIsValidFieldName(key) {
  let match;

  if (typeof key === 'string' && (match = key.match(/^\$|\.|\0/))) {
    throw MinimongoError(`Key ${key} must not ${invalidCharMsg[match[0]]}`);
  }
} // for a.b.c.2.d.e, keyparts should be ['a', 'b', 'c', '2', 'd', 'e'],
// and then you would operate on the 'e' property of the returned
// object.
//
// if options.noCreate is falsey, creates intermediate levels of
// structure as necessary, like mkdir -p (and raises an exception if
// that would mean giving a non-numeric property to an array.) if
// options.noCreate is true, return undefined instead.
//
// may modify the last element of keyparts to signal to the caller that it needs
// to use a different value to index into the returned object (for example,
// ['a', '01'] -> ['a', 1]).
//
// if forbidArray is true, return null if the keypath goes through an array.
//
// if options.arrayIndices is set, use its first element for the (first) '$' in
// the path.


function findModTarget(doc, keyparts, options = {}) {
  let usedArrayIndex = false;

  for (let i = 0; i < keyparts.length; i++) {
    const last = i === keyparts.length - 1;
    let keypart = keyparts[i];

    if (!isIndexable(doc)) {
      if (options.noCreate) {
        return undefined;
      }

      const error = MinimongoError(`cannot use the part '${keypart}' to traverse ${doc}`);
      error.setPropertyError = true;
      throw error;
    }

    if (doc instanceof Array) {
      if (options.forbidArray) {
        return null;
      }

      if (keypart === '$') {
        if (usedArrayIndex) {
          throw MinimongoError('Too many positional (i.e. \'$\') elements');
        }

        if (!options.arrayIndices || !options.arrayIndices.length) {
          throw MinimongoError('The positional operator did not find the match needed from the ' + 'query');
        }

        keypart = options.arrayIndices[0];
        usedArrayIndex = true;
      } else if (isNumericKey(keypart)) {
        keypart = parseInt(keypart);
      } else {
        if (options.noCreate) {
          return undefined;
        }

        throw MinimongoError(`can't append to array using string field name [${keypart}]`);
      }

      if (last) {
        keyparts[i] = keypart; // handle 'a.01'
      }

      if (options.noCreate && keypart >= doc.length) {
        return undefined;
      }

      while (doc.length < keypart) {
        doc.push(null);
      }

      if (!last) {
        if (doc.length === keypart) {
          doc.push({});
        } else if (typeof doc[keypart] !== 'object') {
          throw MinimongoError(`can't modify field '${keyparts[i + 1]}' of list value ` + JSON.stringify(doc[keypart]));
        }
      }
    } else {
      assertIsValidFieldName(keypart);

      if (!(keypart in doc)) {
        if (options.noCreate) {
          return undefined;
        }

        if (!last) {
          doc[keypart] = {};
        }
      }
    }

    if (last) {
      return doc;
    }

    doc = doc[keypart];
  } // notreached

}
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"matcher.js":function(require,exports,module){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/minimongo/matcher.js                                                                                       //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
module.export({
  default: () => Matcher
});
let LocalCollection;
module.watch(require("./local_collection.js"), {
  default(v) {
    LocalCollection = v;
  }

}, 0);
let compileDocumentSelector, hasOwn, nothingMatcher;
module.watch(require("./common.js"), {
  compileDocumentSelector(v) {
    compileDocumentSelector = v;
  },

  hasOwn(v) {
    hasOwn = v;
  },

  nothingMatcher(v) {
    nothingMatcher = v;
  }

}, 1);

class Matcher {
  constructor(selector, isUpdate) {
    // A set (object mapping string -> *) of all of the document paths looked
    // at by the selector. Also includes the empty string if it may look at any
    // path (eg, $where).
    this._paths = {}; // Set to true if compilation finds a $near.

    this._hasGeoQuery = false; // Set to true if compilation finds a $where.

    this._hasWhere = false; // Set to false if compilation finds anything other than a simple equality
    // or one or more of '$gt', '$gte', '$lt', '$lte', '$ne', '$in', '$nin' used
    // with scalars as operands.

    this._isSimple = true; // Set to a dummy document which always matches this Matcher. Or set to null
    // if such document is too hard to find.

    this._matchingDocument = undefined; // A clone of the original selector. It may just be a function if the user
    // passed in a function; otherwise is definitely an object (eg, IDs are
    // translated into {_id: ID} first. Used by canBecomeTrueByModifier and
    // Sorter._useWithMatcher.

    this._selector = null;
    this._docMatcher = this._compileSelector(selector); // Set to true if selection is done for an update operation
    // Default is false
    // Used for $near array update (issue #3599)

    this._isUpdate = isUpdate;
  }

  documentMatches(doc) {
    if (doc !== Object(doc)) {
      throw Error('documentMatches needs a document');
    }

    return this._docMatcher(doc);
  }

  hasGeoQuery() {
    return this._hasGeoQuery;
  }

  hasWhere() {
    return this._hasWhere;
  }

  isSimple() {
    return this._isSimple;
  } // Given a selector, return a function that takes one argument, a
  // document. It returns a result object.


  _compileSelector(selector) {
    // you can pass a literal function instead of a selector
    if (selector instanceof Function) {
      this._isSimple = false;
      this._selector = selector;

      this._recordPathUsed('');

      return doc => ({
        result: !!selector.call(doc)
      });
    } // shorthand -- scalar _id


    if (LocalCollection._selectorIsId(selector)) {
      this._selector = {
        _id: selector
      };

      this._recordPathUsed('_id');

      return doc => ({
        result: EJSON.equals(doc._id, selector)
      });
    } // protect against dangerous selectors.  falsey and {_id: falsey} are both
    // likely programmer error, and not what you want, particularly for
    // destructive operations.


    if (!selector || hasOwn.call(selector, '_id') && !selector._id) {
      this._isSimple = false;
      return nothingMatcher;
    } // Top level can't be an array or true or binary.


    if (Array.isArray(selector) || EJSON.isBinary(selector) || typeof selector === 'boolean') {
      throw new Error(`Invalid selector: ${selector}`);
    }

    this._selector = EJSON.clone(selector);
    return compileDocumentSelector(selector, this, {
      isRoot: true
    });
  } // Returns a list of key paths the given selector is looking for. It includes
  // the empty string if there is a $where.


  _getPaths() {
    return Object.keys(this._paths);
  }

  _recordPathUsed(path) {
    this._paths[path] = true;
  }

}

// helpers used by compiled selector code
LocalCollection._f = {
  // XXX for _all and _in, consider building 'inquery' at compile time..
  _type(v) {
    if (typeof v === 'number') {
      return 1;
    }

    if (typeof v === 'string') {
      return 2;
    }

    if (typeof v === 'boolean') {
      return 8;
    }

    if (Array.isArray(v)) {
      return 4;
    }

    if (v === null) {
      return 10;
    } // note that typeof(/x/) === "object"


    if (v instanceof RegExp) {
      return 11;
    }

    if (typeof v === 'function') {
      return 13;
    }

    if (v instanceof Date) {
      return 9;
    }

    if (EJSON.isBinary(v)) {
      return 5;
    }

    if (v instanceof MongoID.ObjectID) {
      return 7;
    } // object


    return 3; // XXX support some/all of these:
    // 14, symbol
    // 15, javascript code with scope
    // 16, 18: 32-bit/64-bit integer
    // 17, timestamp
    // 255, minkey
    // 127, maxkey
  },

  // deep equality test: use for literal document and array matches
  _equal(a, b) {
    return EJSON.equals(a, b, {
      keyOrderSensitive: true
    });
  },

  // maps a type code to a value that can be used to sort values of different
  // types
  _typeorder(t) {
    // http://www.mongodb.org/display/DOCS/What+is+the+Compare+Order+for+BSON+Types
    // XXX what is the correct sort position for Javascript code?
    // ('100' in the matrix below)
    // XXX minkey/maxkey
    return [-1, // (not a type)
    1, // number
    2, // string
    3, // object
    4, // array
    5, // binary
    -1, // deprecated
    6, // ObjectID
    7, // bool
    8, // Date
    0, // null
    9, // RegExp
    -1, // deprecated
    100, // JS code
    2, // deprecated (symbol)
    100, // JS code
    1, // 32-bit int
    8, // Mongo timestamp
    1 // 64-bit int
    ][t];
  },

  // compare two values of unknown type according to BSON ordering
  // semantics. (as an extension, consider 'undefined' to be less than
  // any other value.) return negative if a is less, positive if b is
  // less, or 0 if equal
  _cmp(a, b) {
    if (a === undefined) {
      return b === undefined ? 0 : -1;
    }

    if (b === undefined) {
      return 1;
    }

    let ta = LocalCollection._f._type(a);

    let tb = LocalCollection._f._type(b);

    const oa = LocalCollection._f._typeorder(ta);

    const ob = LocalCollection._f._typeorder(tb);

    if (oa !== ob) {
      return oa < ob ? -1 : 1;
    } // XXX need to implement this if we implement Symbol or integers, or
    // Timestamp


    if (ta !== tb) {
      throw Error('Missing type coercion logic in _cmp');
    }

    if (ta === 7) {
      // ObjectID
      // Convert to string.
      ta = tb = 2;
      a = a.toHexString();
      b = b.toHexString();
    }

    if (ta === 9) {
      // Date
      // Convert to millis.
      ta = tb = 1;
      a = a.getTime();
      b = b.getTime();
    }

    if (ta === 1) // double
      return a - b;
    if (tb === 2) // string
      return a < b ? -1 : a === b ? 0 : 1;

    if (ta === 3) {
      // Object
      // this could be much more efficient in the expected case ...
      const toArray = object => {
        const result = [];
        Object.keys(object).forEach(key => {
          result.push(key, object[key]);
        });
        return result;
      };

      return LocalCollection._f._cmp(toArray(a), toArray(b));
    }

    if (ta === 4) {
      // Array
      for (let i = 0;; i++) {
        if (i === a.length) {
          return i === b.length ? 0 : -1;
        }

        if (i === b.length) {
          return 1;
        }

        const s = LocalCollection._f._cmp(a[i], b[i]);

        if (s !== 0) {
          return s;
        }
      }
    }

    if (ta === 5) {
      // binary
      // Surprisingly, a small binary blob is always less than a large one in
      // Mongo.
      if (a.length !== b.length) {
        return a.length - b.length;
      }

      for (let i = 0; i < a.length; i++) {
        if (a[i] < b[i]) {
          return -1;
        }

        if (a[i] > b[i]) {
          return 1;
        }
      }

      return 0;
    }

    if (ta === 8) {
      // boolean
      if (a) {
        return b ? 0 : 1;
      }

      return b ? -1 : 0;
    }

    if (ta === 10) // null
      return 0;
    if (ta === 11) // regexp
      throw Error('Sorting not supported on regular expression'); // XXX
    // 13: javascript code
    // 14: symbol
    // 15: javascript code with scope
    // 16: 32-bit integer
    // 17: timestamp
    // 18: 64-bit integer
    // 255: minkey
    // 127: maxkey

    if (ta === 13) // javascript code
      throw Error('Sorting not supported on Javascript code'); // XXX

    throw Error('Unknown type to sort');
  }

};
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"minimongo_common.js":function(require,exports,module){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/minimongo/minimongo_common.js                                                                              //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
let LocalCollection_;
module.watch(require("./local_collection.js"), {
    default(v) {
        LocalCollection_ = v;
    }

}, 0);
let Matcher;
module.watch(require("./matcher.js"), {
    default(v) {
        Matcher = v;
    }

}, 1);
let Sorter;
module.watch(require("./sorter.js"), {
    default(v) {
        Sorter = v;
    }

}, 2);
LocalCollection = LocalCollection_;
Minimongo = {
    LocalCollection: LocalCollection_,
    Matcher,
    Sorter
};
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"observe_handle.js":function(require,exports,module){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/minimongo/observe_handle.js                                                                                //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
module.export({
  default: () => ObserveHandle
});

class ObserveHandle {}
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"sorter.js":function(require,exports,module){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/minimongo/sorter.js                                                                                        //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
module.export({
  default: () => Sorter
});
let ELEMENT_OPERATORS, equalityElementMatcher, expandArraysInBranches, hasOwn, isOperatorObject, makeLookupFunction, regexpElementMatcher;
module.watch(require("./common.js"), {
  ELEMENT_OPERATORS(v) {
    ELEMENT_OPERATORS = v;
  },

  equalityElementMatcher(v) {
    equalityElementMatcher = v;
  },

  expandArraysInBranches(v) {
    expandArraysInBranches = v;
  },

  hasOwn(v) {
    hasOwn = v;
  },

  isOperatorObject(v) {
    isOperatorObject = v;
  },

  makeLookupFunction(v) {
    makeLookupFunction = v;
  },

  regexpElementMatcher(v) {
    regexpElementMatcher = v;
  }

}, 0);

class Sorter {
  constructor(spec, options = {}) {
    this._sortSpecParts = [];
    this._sortFunction = null;

    const addSpecPart = (path, ascending) => {
      if (!path) {
        throw Error('sort keys must be non-empty');
      }

      if (path.charAt(0) === '$') {
        throw Error(`unsupported sort key: ${path}`);
      }

      this._sortSpecParts.push({
        ascending,
        lookup: makeLookupFunction(path, {
          forSort: true
        }),
        path
      });
    };

    if (spec instanceof Array) {
      spec.forEach(element => {
        if (typeof element === 'string') {
          addSpecPart(element, true);
        } else {
          addSpecPart(element[0], element[1] !== 'desc');
        }
      });
    } else if (typeof spec === 'object') {
      Object.keys(spec).forEach(key => {
        addSpecPart(key, spec[key] >= 0);
      });
    } else if (typeof spec === 'function') {
      this._sortFunction = spec;
    } else {
      throw Error(`Bad sort specification: ${JSON.stringify(spec)}`);
    } // If a function is specified for sorting, we skip the rest.


    if (this._sortFunction) {
      return;
    } // To implement affectedByModifier, we piggy-back on top of Matcher's
    // affectedByModifier code; we create a selector that is affected by the
    // same modifiers as this sort order. This is only implemented on the
    // server.


    if (this.affectedByModifier) {
      const selector = {};

      this._sortSpecParts.forEach(spec => {
        selector[spec.path] = 1;
      });

      this._selectorForAffectedByModifier = new Minimongo.Matcher(selector);
    }

    this._keyComparator = composeComparators(this._sortSpecParts.map((spec, i) => this._keyFieldComparator(i))); // If you specify a matcher for this Sorter, _keyFilter may be set to a
    // function which selects whether or not a given "sort key" (tuple of values
    // for the different sort spec fields) is compatible with the selector.

    this._keyFilter = null;

    if (options.matcher) {
      this._useWithMatcher(options.matcher);
    }
  }

  getComparator(options) {
    // If sort is specified or have no distances, just use the comparator from
    // the source specification (which defaults to "everything is equal".
    // issue #3599
    // https://docs.mongodb.com/manual/reference/operator/query/near/#sort-operation
    // sort effectively overrides $near
    if (this._sortSpecParts.length || !options || !options.distances) {
      return this._getBaseComparator();
    }

    const distances = options.distances; // Return a comparator which compares using $near distances.

    return (a, b) => {
      if (!distances.has(a._id)) {
        throw Error(`Missing distance for ${a._id}`);
      }

      if (!distances.has(b._id)) {
        throw Error(`Missing distance for ${b._id}`);
      }

      return distances.get(a._id) - distances.get(b._id);
    };
  } // Takes in two keys: arrays whose lengths match the number of spec
  // parts. Returns negative, 0, or positive based on using the sort spec to
  // compare fields.


  _compareKeys(key1, key2) {
    if (key1.length !== this._sortSpecParts.length || key2.length !== this._sortSpecParts.length) {
      throw Error('Key has wrong length');
    }

    return this._keyComparator(key1, key2);
  } // Iterates over each possible "key" from doc (ie, over each branch), calling
  // 'cb' with the key.


  _generateKeysFromDoc(doc, cb) {
    if (this._sortSpecParts.length === 0) {
      throw new Error('can\'t generate keys without a spec');
    }

    const pathFromIndices = indices => `${indices.join(',')},`;

    let knownPaths = null; // maps index -> ({'' -> value} or {path -> value})

    const valuesByIndexAndPath = this._sortSpecParts.map(spec => {
      // Expand any leaf arrays that we find, and ignore those arrays
      // themselves.  (We never sort based on an array itself.)
      let branches = expandArraysInBranches(spec.lookup(doc), true); // If there are no values for a key (eg, key goes to an empty array),
      // pretend we found one null value.

      if (!branches.length) {
        branches = [{
          value: null
        }];
      }

      const element = Object.create(null);
      let usedPaths = false;
      branches.forEach(branch => {
        if (!branch.arrayIndices) {
          // If there are no array indices for a branch, then it must be the
          // only branch, because the only thing that produces multiple branches
          // is the use of arrays.
          if (branches.length > 1) {
            throw Error('multiple branches but no array used?');
          }

          element[''] = branch.value;
          return;
        }

        usedPaths = true;
        const path = pathFromIndices(branch.arrayIndices);

        if (hasOwn.call(element, path)) {
          throw Error(`duplicate path: ${path}`);
        }

        element[path] = branch.value; // If two sort fields both go into arrays, they have to go into the
        // exact same arrays and we have to find the same paths.  This is
        // roughly the same condition that makes MongoDB throw this strange
        // error message.  eg, the main thing is that if sort spec is {a: 1,
        // b:1} then a and b cannot both be arrays.
        //
        // (In MongoDB it seems to be OK to have {a: 1, 'a.x.y': 1} where 'a'
        // and 'a.x.y' are both arrays, but we don't allow this for now.
        // #NestedArraySort
        // XXX achieve full compatibility here

        if (knownPaths && !hasOwn.call(knownPaths, path)) {
          throw Error('cannot index parallel arrays');
        }
      });

      if (knownPaths) {
        // Similarly to above, paths must match everywhere, unless this is a
        // non-array field.
        if (!hasOwn.call(element, '') && Object.keys(knownPaths).length !== Object.keys(element).length) {
          throw Error('cannot index parallel arrays!');
        }
      } else if (usedPaths) {
        knownPaths = {};
        Object.keys(element).forEach(path => {
          knownPaths[path] = true;
        });
      }

      return element;
    });

    if (!knownPaths) {
      // Easy case: no use of arrays.
      const soleKey = valuesByIndexAndPath.map(values => {
        if (!hasOwn.call(values, '')) {
          throw Error('no value in sole key case?');
        }

        return values[''];
      });
      cb(soleKey);
      return;
    }

    Object.keys(knownPaths).forEach(path => {
      const key = valuesByIndexAndPath.map(values => {
        if (hasOwn.call(values, '')) {
          return values[''];
        }

        if (!hasOwn.call(values, path)) {
          throw Error('missing path?');
        }

        return values[path];
      });
      cb(key);
    });
  } // Returns a comparator that represents the sort specification (but not
  // including a possible geoquery distance tie-breaker).


  _getBaseComparator() {
    if (this._sortFunction) {
      return this._sortFunction;
    } // If we're only sorting on geoquery distance and no specs, just say
    // everything is equal.


    if (!this._sortSpecParts.length) {
      return (doc1, doc2) => 0;
    }

    return (doc1, doc2) => {
      const key1 = this._getMinKeyFromDoc(doc1);

      const key2 = this._getMinKeyFromDoc(doc2);

      return this._compareKeys(key1, key2);
    };
  } // Finds the minimum key from the doc, according to the sort specs.  (We say
  // "minimum" here but this is with respect to the sort spec, so "descending"
  // sort fields mean we're finding the max for that field.)
  //
  // Note that this is NOT "find the minimum value of the first field, the
  // minimum value of the second field, etc"... it's "choose the
  // lexicographically minimum value of the key vector, allowing only keys which
  // you can find along the same paths".  ie, for a doc {a: [{x: 0, y: 5}, {x:
  // 1, y: 3}]} with sort spec {'a.x': 1, 'a.y': 1}, the only keys are [0,5] and
  // [1,3], and the minimum key is [0,5]; notably, [0,3] is NOT a key.


  _getMinKeyFromDoc(doc) {
    let minKey = null;

    this._generateKeysFromDoc(doc, key => {
      if (!this._keyCompatibleWithSelector(key)) {
        return;
      }

      if (minKey === null) {
        minKey = key;
        return;
      }

      if (this._compareKeys(key, minKey) < 0) {
        minKey = key;
      }
    }); // This could happen if our key filter somehow filters out all the keys even
    // though somehow the selector matches.


    if (minKey === null) {
      throw Error('sort selector found no keys in doc?');
    }

    return minKey;
  }

  _getPaths() {
    return this._sortSpecParts.map(part => part.path);
  }

  _keyCompatibleWithSelector(key) {
    return !this._keyFilter || this._keyFilter(key);
  } // Given an index 'i', returns a comparator that compares two key arrays based
  // on field 'i'.


  _keyFieldComparator(i) {
    const invert = !this._sortSpecParts[i].ascending;
    return (key1, key2) => {
      const compare = LocalCollection._f._cmp(key1[i], key2[i]);

      return invert ? -compare : compare;
    };
  } // In MongoDB, if you have documents
  //    {_id: 'x', a: [1, 10]} and
  //    {_id: 'y', a: [5, 15]},
  // then C.find({}, {sort: {a: 1}}) puts x before y (1 comes before 5).
  // But  C.find({a: {$gt: 3}}, {sort: {a: 1}}) puts y before x (1 does not
  // match the selector, and 5 comes before 10).
  //
  // The way this works is pretty subtle!  For example, if the documents
  // are instead {_id: 'x', a: [{x: 1}, {x: 10}]}) and
  //             {_id: 'y', a: [{x: 5}, {x: 15}]}),
  // then C.find({'a.x': {$gt: 3}}, {sort: {'a.x': 1}}) and
  //      C.find({a: {$elemMatch: {x: {$gt: 3}}}}, {sort: {'a.x': 1}})
  // both follow this rule (y before x).  (ie, you do have to apply this
  // through $elemMatch.)
  //
  // So if you pass a matcher to this sorter's constructor, we will attempt to
  // skip sort keys that don't match the selector. The logic here is pretty
  // subtle and undocumented; we've gotten as close as we can figure out based
  // on our understanding of Mongo's behavior.


  _useWithMatcher(matcher) {
    if (this._keyFilter) {
      throw Error('called _useWithMatcher twice?');
    } // If we are only sorting by distance, then we're not going to bother to
    // build a key filter.
    // XXX figure out how geoqueries interact with this stuff


    if (!this._sortSpecParts.length) {
      return;
    }

    const selector = matcher._selector; // If the user just passed a literal function to find(), then we can't get a
    // key filter from it.

    if (selector instanceof Function) {
      return;
    }

    const constraintsByPath = {};

    this._sortSpecParts.forEach(spec => {
      constraintsByPath[spec.path] = [];
    });

    Object.keys(selector).forEach(key => {
      const subSelector = selector[key]; // XXX support $and and $or

      const constraints = constraintsByPath[key];

      if (!constraints) {
        return;
      } // XXX it looks like the real MongoDB implementation isn't "does the
      // regexp match" but "does the value fall into a range named by the
      // literal prefix of the regexp", ie "foo" in /^foo(bar|baz)+/  But
      // "does the regexp match" is a good approximation.


      if (subSelector instanceof RegExp) {
        // As far as we can tell, using either of the options that both we and
        // MongoDB support ('i' and 'm') disables use of the key filter. This
        // makes sense: MongoDB mostly appears to be calculating ranges of an
        // index to use, which means it only cares about regexps that match
        // one range (with a literal prefix), and both 'i' and 'm' prevent the
        // literal prefix of the regexp from actually meaning one range.
        if (subSelector.ignoreCase || subSelector.multiline) {
          return;
        }

        constraints.push(regexpElementMatcher(subSelector));
        return;
      }

      if (isOperatorObject(subSelector)) {
        Object.keys(subSelector).forEach(operator => {
          const operand = subSelector[operator];

          if (['$lt', '$lte', '$gt', '$gte'].includes(operator)) {
            // XXX this depends on us knowing that these operators don't use any
            // of the arguments to compileElementSelector other than operand.
            constraints.push(ELEMENT_OPERATORS[operator].compileElementSelector(operand));
          } // See comments in the RegExp block above.


          if (operator === '$regex' && !subSelector.$options) {
            constraints.push(ELEMENT_OPERATORS.$regex.compileElementSelector(operand, subSelector));
          } // XXX support {$exists: true}, $mod, $type, $in, $elemMatch

        });
        return;
      } // OK, it's an equality thing.


      constraints.push(equalityElementMatcher(subSelector));
    }); // It appears that the first sort field is treated differently from the
    // others; we shouldn't create a key filter unless the first sort field is
    // restricted, though after that point we can restrict the other sort fields
    // or not as we wish.

    if (!constraintsByPath[this._sortSpecParts[0].path].length) {
      return;
    }

    this._keyFilter = key => this._sortSpecParts.every((specPart, index) => constraintsByPath[specPart.path].every(fn => fn(key[index])));
  }

}

// Given an array of comparators
// (functions (a,b)->(negative or positive or zero)), returns a single
// comparator which uses each comparator in order and returns the first
// non-zero value.
function composeComparators(comparatorArray) {
  return (a, b) => {
    for (let i = 0; i < comparatorArray.length; ++i) {
      const compare = comparatorArray[i](a, b);

      if (compare !== 0) {
        return compare;
      }
    }

    return 0;
  };
}
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

}}}}},{
  "extensions": [
    ".js",
    ".json"
  ]
});
var exports = require("./node_modules/meteor/minimongo/minimongo_server.js");

/* Exports */
if (typeof Package === 'undefined') Package = {};
(function (pkg, symbols) {
  for (var s in symbols)
    (s in pkg) || (pkg[s] = symbols[s]);
})(Package.minimongo = exports, {
  LocalCollection: LocalCollection,
  Minimongo: Minimongo,
  MinimongoTest: MinimongoTest,
  MinimongoError: MinimongoError
});

})();

//# sourceURL=meteor://💻app/packages/minimongo.js
//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvbWluaW1vbmdvL21pbmltb25nb19zZXJ2ZXIuanMiLCJtZXRlb3I6Ly/wn5K7YXBwL3BhY2thZ2VzL21pbmltb25nby9jb21tb24uanMiLCJtZXRlb3I6Ly/wn5K7YXBwL3BhY2thZ2VzL21pbmltb25nby9jdXJzb3IuanMiLCJtZXRlb3I6Ly/wn5K7YXBwL3BhY2thZ2VzL21pbmltb25nby9sb2NhbF9jb2xsZWN0aW9uLmpzIiwibWV0ZW9yOi8v8J+Su2FwcC9wYWNrYWdlcy9taW5pbW9uZ28vbWF0Y2hlci5qcyIsIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvbWluaW1vbmdvL21pbmltb25nb19jb21tb24uanMiLCJtZXRlb3I6Ly/wn5K7YXBwL3BhY2thZ2VzL21pbmltb25nby9vYnNlcnZlX2hhbmRsZS5qcyIsIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvbWluaW1vbmdvL3NvcnRlci5qcyJdLCJuYW1lcyI6WyJtb2R1bGUiLCJ3YXRjaCIsInJlcXVpcmUiLCJoYXNPd24iLCJpc051bWVyaWNLZXkiLCJpc09wZXJhdG9yT2JqZWN0IiwicGF0aHNUb1RyZWUiLCJwcm9qZWN0aW9uRGV0YWlscyIsInYiLCJNaW5pbW9uZ28iLCJfcGF0aHNFbGlkaW5nTnVtZXJpY0tleXMiLCJwYXRocyIsIm1hcCIsInBhdGgiLCJzcGxpdCIsImZpbHRlciIsInBhcnQiLCJqb2luIiwiTWF0Y2hlciIsInByb3RvdHlwZSIsImFmZmVjdGVkQnlNb2RpZmllciIsIm1vZGlmaWVyIiwiT2JqZWN0IiwiYXNzaWduIiwiJHNldCIsIiR1bnNldCIsIm1lYW5pbmdmdWxQYXRocyIsIl9nZXRQYXRocyIsIm1vZGlmaWVkUGF0aHMiLCJjb25jYXQiLCJrZXlzIiwic29tZSIsIm1vZCIsIm1lYW5pbmdmdWxQYXRoIiwic2VsIiwiaSIsImoiLCJsZW5ndGgiLCJjYW5CZWNvbWVUcnVlQnlNb2RpZmllciIsImlzU2ltcGxlIiwibW9kaWZpZXJQYXRocyIsInBhdGhIYXNOdW1lcmljS2V5cyIsImV4cGVjdGVkU2NhbGFySXNPYmplY3QiLCJfc2VsZWN0b3IiLCJtb2RpZmllclBhdGgiLCJzdGFydHNXaXRoIiwibWF0Y2hpbmdEb2N1bWVudCIsIkVKU09OIiwiY2xvbmUiLCJMb2NhbENvbGxlY3Rpb24iLCJfbW9kaWZ5IiwiZXJyb3IiLCJuYW1lIiwic2V0UHJvcGVydHlFcnJvciIsImRvY3VtZW50TWF0Y2hlcyIsInJlc3VsdCIsImNvbWJpbmVJbnRvUHJvamVjdGlvbiIsInByb2plY3Rpb24iLCJzZWxlY3RvclBhdGhzIiwiaW5jbHVkZXMiLCJjb21iaW5lSW1wb3J0YW50UGF0aHNJbnRvUHJvamVjdGlvbiIsIl9tYXRjaGluZ0RvY3VtZW50IiwidW5kZWZpbmVkIiwiZmFsbGJhY2siLCJ2YWx1ZVNlbGVjdG9yIiwiJGVxIiwiJGluIiwibWF0Y2hlciIsInBsYWNlaG9sZGVyIiwiZmluZCIsIm9ubHlDb250YWluc0tleXMiLCJsb3dlckJvdW5kIiwiSW5maW5pdHkiLCJ1cHBlckJvdW5kIiwiZm9yRWFjaCIsIm9wIiwiY2FsbCIsIm1pZGRsZSIsIngiLCJTb3J0ZXIiLCJfc2VsZWN0b3JGb3JBZmZlY3RlZEJ5TW9kaWZpZXIiLCJkZXRhaWxzIiwidHJlZSIsIm5vZGUiLCJmdWxsUGF0aCIsIm1lcmdlZFByb2plY3Rpb24iLCJ0cmVlVG9QYXRocyIsImluY2x1ZGluZyIsIm1lcmdlZEV4Y2xQcm9qZWN0aW9uIiwiZ2V0UGF0aHMiLCJzZWxlY3RvciIsIl9wYXRocyIsIm9iaiIsImV2ZXJ5IiwiayIsInByZWZpeCIsImtleSIsInZhbHVlIiwiZXhwb3J0IiwiRUxFTUVOVF9PUEVSQVRPUlMiLCJjb21waWxlRG9jdW1lbnRTZWxlY3RvciIsImVxdWFsaXR5RWxlbWVudE1hdGNoZXIiLCJleHBhbmRBcnJheXNJbkJyYW5jaGVzIiwiaXNJbmRleGFibGUiLCJtYWtlTG9va3VwRnVuY3Rpb24iLCJub3RoaW5nTWF0Y2hlciIsInBvcHVsYXRlRG9jdW1lbnRXaXRoUXVlcnlGaWVsZHMiLCJyZWdleHBFbGVtZW50TWF0Y2hlciIsImRlZmF1bHQiLCJoYXNPd25Qcm9wZXJ0eSIsIiRsdCIsIm1ha2VJbmVxdWFsaXR5IiwiY21wVmFsdWUiLCIkZ3QiLCIkbHRlIiwiJGd0ZSIsIiRtb2QiLCJjb21waWxlRWxlbWVudFNlbGVjdG9yIiwib3BlcmFuZCIsIkFycmF5IiwiaXNBcnJheSIsIkVycm9yIiwiZGl2aXNvciIsInJlbWFpbmRlciIsImVsZW1lbnRNYXRjaGVycyIsIm9wdGlvbiIsIlJlZ0V4cCIsIiRzaXplIiwiZG9udEV4cGFuZExlYWZBcnJheXMiLCIkdHlwZSIsImRvbnRJbmNsdWRlTGVhZkFycmF5cyIsIl9mIiwiX3R5cGUiLCIkYml0c0FsbFNldCIsIm1hc2siLCJnZXRPcGVyYW5kQml0bWFzayIsImJpdG1hc2siLCJnZXRWYWx1ZUJpdG1hc2siLCJieXRlIiwiJGJpdHNBbnlTZXQiLCIkYml0c0FsbENsZWFyIiwiJGJpdHNBbnlDbGVhciIsIiRyZWdleCIsInJlZ2V4cCIsIiRvcHRpb25zIiwidGVzdCIsInNvdXJjZSIsIiRlbGVtTWF0Y2giLCJfaXNQbGFpbk9iamVjdCIsImlzRG9jTWF0Y2hlciIsIkxPR0lDQUxfT1BFUkFUT1JTIiwicmVkdWNlIiwiYSIsImIiLCJzdWJNYXRjaGVyIiwiaW5FbGVtTWF0Y2giLCJjb21waWxlVmFsdWVTZWxlY3RvciIsImFycmF5RWxlbWVudCIsImFyZyIsImRvbnRJdGVyYXRlIiwiJGFuZCIsInN1YlNlbGVjdG9yIiwiYW5kRG9jdW1lbnRNYXRjaGVycyIsImNvbXBpbGVBcnJheU9mRG9jdW1lbnRTZWxlY3RvcnMiLCIkb3IiLCJtYXRjaGVycyIsImRvYyIsImZuIiwiJG5vciIsIiR3aGVyZSIsInNlbGVjdG9yVmFsdWUiLCJfcmVjb3JkUGF0aFVzZWQiLCJfaGFzV2hlcmUiLCJGdW5jdGlvbiIsIiRjb21tZW50IiwiVkFMVUVfT1BFUkFUT1JTIiwiY29udmVydEVsZW1lbnRNYXRjaGVyVG9CcmFuY2hlZE1hdGNoZXIiLCIkbm90IiwiaW52ZXJ0QnJhbmNoZWRNYXRjaGVyIiwiJG5lIiwiJG5pbiIsIiRleGlzdHMiLCJleGlzdHMiLCJldmVyeXRoaW5nTWF0Y2hlciIsIiRtYXhEaXN0YW5jZSIsIiRuZWFyIiwiJGFsbCIsImJyYW5jaGVkTWF0Y2hlcnMiLCJjcml0ZXJpb24iLCJhbmRCcmFuY2hlZE1hdGNoZXJzIiwiaXNSb290IiwiX2hhc0dlb1F1ZXJ5IiwibWF4RGlzdGFuY2UiLCJwb2ludCIsImRpc3RhbmNlIiwiJGdlb21ldHJ5IiwidHlwZSIsIkdlb0pTT04iLCJwb2ludERpc3RhbmNlIiwiY29vcmRpbmF0ZXMiLCJwb2ludFRvQXJyYXkiLCJnZW9tZXRyeVdpdGhpblJhZGl1cyIsImRpc3RhbmNlQ29vcmRpbmF0ZVBhaXJzIiwiYnJhbmNoZWRWYWx1ZXMiLCJicmFuY2giLCJjdXJEaXN0YW5jZSIsIl9pc1VwZGF0ZSIsImFycmF5SW5kaWNlcyIsImFuZFNvbWVNYXRjaGVycyIsInN1Yk1hdGNoZXJzIiwiZG9jT3JCcmFuY2hlcyIsIm1hdGNoIiwic3ViUmVzdWx0Iiwic2VsZWN0b3JzIiwiZG9jU2VsZWN0b3IiLCJvcHRpb25zIiwiZG9jTWF0Y2hlcnMiLCJzdWJzdHIiLCJfaXNTaW1wbGUiLCJsb29rVXBCeUluZGV4IiwidmFsdWVNYXRjaGVyIiwiQm9vbGVhbiIsIm9wZXJhdG9yQnJhbmNoZWRNYXRjaGVyIiwiZWxlbWVudE1hdGNoZXIiLCJicmFuY2hlcyIsImV4cGFuZGVkIiwiZWxlbWVudCIsIm1hdGNoZWQiLCJwb2ludEEiLCJwb2ludEIiLCJNYXRoIiwiaHlwb3QiLCJlbGVtZW50U2VsZWN0b3IiLCJfZXF1YWwiLCJkb2NPckJyYW5jaGVkVmFsdWVzIiwic2tpcFRoZUFycmF5cyIsImJyYW5jaGVzT3V0IiwidGhpc0lzQXJyYXkiLCJwdXNoIiwiTnVtYmVyIiwiaXNJbnRlZ2VyIiwiVWludDhBcnJheSIsIkludDMyQXJyYXkiLCJidWZmZXIiLCJpc0JpbmFyeSIsIkFycmF5QnVmZmVyIiwibWF4IiwidmlldyIsImlzU2FmZUludGVnZXIiLCJVaW50MzJBcnJheSIsIkJZVEVTX1BFUl9FTEVNRU5UIiwiaW5zZXJ0SW50b0RvY3VtZW50IiwiZG9jdW1lbnQiLCJleGlzdGluZ0tleSIsImluZGV4T2YiLCJicmFuY2hlZE1hdGNoZXIiLCJicmFuY2hWYWx1ZXMiLCJzIiwiaW5jb25zaXN0ZW50T0siLCJ0aGVzZUFyZU9wZXJhdG9ycyIsInNlbEtleSIsInRoaXNJc09wZXJhdG9yIiwiSlNPTiIsInN0cmluZ2lmeSIsImNtcFZhbHVlQ29tcGFyYXRvciIsIm9wZXJhbmRUeXBlIiwiX2NtcCIsInBhcnRzIiwiZmlyc3RQYXJ0IiwibG9va3VwUmVzdCIsInNsaWNlIiwib21pdFVubmVjZXNzYXJ5RmllbGRzIiwiZmlyc3RMZXZlbCIsImFwcGVuZFRvUmVzdWx0IiwibW9yZSIsImZvclNvcnQiLCJhcnJheUluZGV4IiwiTWluaW1vbmdvVGVzdCIsIk1pbmltb25nb0Vycm9yIiwibWVzc2FnZSIsImZpZWxkIiwib3BlcmF0b3JNYXRjaGVycyIsIm9wZXJhdG9yIiwic2ltcGxlUmFuZ2UiLCJzaW1wbGVFcXVhbGl0eSIsInNpbXBsZUluY2x1c2lvbiIsIm5ld0xlYWZGbiIsImNvbmZsaWN0Rm4iLCJyb290IiwicGF0aEFycmF5Iiwic3VjY2VzcyIsImxhc3RLZXkiLCJ5IiwicG9wdWxhdGVEb2N1bWVudFdpdGhLZXlWYWx1ZSIsImdldFByb3RvdHlwZU9mIiwicG9wdWxhdGVEb2N1bWVudFdpdGhPYmplY3QiLCJ1bnByZWZpeGVkS2V5cyIsInZhbGlkYXRlT2JqZWN0Iiwib2JqZWN0IiwicXVlcnkiLCJfc2VsZWN0b3JJc0lkIiwiZmllbGRzIiwiZmllbGRzS2V5cyIsInNvcnQiLCJfaWQiLCJrZXlQYXRoIiwicnVsZSIsInByb2plY3Rpb25SdWxlc1RyZWUiLCJjdXJyZW50UGF0aCIsImFub3RoZXJQYXRoIiwidG9TdHJpbmciLCJsYXN0SW5kZXgiLCJ2YWxpZGF0ZUtleUluUGF0aCIsIkN1cnNvciIsImNvbnN0cnVjdG9yIiwiY29sbGVjdGlvbiIsInNvcnRlciIsIl9zZWxlY3RvcklzSWRQZXJoYXBzQXNPYmplY3QiLCJfc2VsZWN0b3JJZCIsImhhc0dlb1F1ZXJ5Iiwic2tpcCIsImxpbWl0IiwiX3Byb2plY3Rpb25GbiIsIl9jb21waWxlUHJvamVjdGlvbiIsIl90cmFuc2Zvcm0iLCJ3cmFwVHJhbnNmb3JtIiwidHJhbnNmb3JtIiwiVHJhY2tlciIsInJlYWN0aXZlIiwiY291bnQiLCJfZGVwZW5kIiwiYWRkZWQiLCJyZW1vdmVkIiwiX2dldFJhd09iamVjdHMiLCJvcmRlcmVkIiwiZmV0Y2giLCJTeW1ib2wiLCJpdGVyYXRvciIsImFkZGVkQmVmb3JlIiwiY2hhbmdlZCIsIm1vdmVkQmVmb3JlIiwiaW5kZXgiLCJvYmplY3RzIiwibmV4dCIsImRvbmUiLCJjYWxsYmFjayIsInRoaXNBcmciLCJnZXRUcmFuc2Zvcm0iLCJvYnNlcnZlIiwiX29ic2VydmVGcm9tT2JzZXJ2ZUNoYW5nZXMiLCJvYnNlcnZlQ2hhbmdlcyIsIl9vYnNlcnZlQ2hhbmdlc0NhbGxiYWNrc0FyZU9yZGVyZWQiLCJfYWxsb3dfdW5vcmRlcmVkIiwiZGlzdGFuY2VzIiwiX0lkTWFwIiwiY3Vyc29yIiwiZGlydHkiLCJwcm9qZWN0aW9uRm4iLCJyZXN1bHRzU25hcHNob3QiLCJxaWQiLCJuZXh0X3FpZCIsInF1ZXJpZXMiLCJyZXN1bHRzIiwicGF1c2VkIiwid3JhcENhbGxiYWNrIiwic2VsZiIsImFyZ3MiLCJhcmd1bWVudHMiLCJfb2JzZXJ2ZVF1ZXVlIiwicXVldWVUYXNrIiwiYXBwbHkiLCJfc3VwcHJlc3NfaW5pdGlhbCIsIl9tYXAiLCJoYW5kbGUiLCJPYnNlcnZlSGFuZGxlIiwic3RvcCIsImFjdGl2ZSIsIm9uSW52YWxpZGF0ZSIsImRyYWluIiwicmV3aW5kIiwiY2hhbmdlcnMiLCJkZXBlbmRlbmN5IiwiRGVwZW5kZW5jeSIsIm5vdGlmeSIsImJpbmQiLCJkZXBlbmQiLCJfZ2V0Q29sbGVjdGlvbk5hbWUiLCJzZWxlY3RlZERvYyIsIl9kb2NzIiwiZ2V0Iiwic2V0IiwiY2xlYXIiLCJpZCIsIm1hdGNoUmVzdWx0IiwiZ2V0Q29tcGFyYXRvciIsIl9wdWJsaXNoQ3Vyc29yIiwic3Vic2NyaXB0aW9uIiwiUGFja2FnZSIsIm1vbmdvIiwiTW9uZ28iLCJDb2xsZWN0aW9uIiwiTWV0ZW9yIiwiX1N5bmNocm9ub3VzUXVldWUiLCJjcmVhdGUiLCJfc2F2ZWRPcmlnaW5hbHMiLCJmaW5kT25lIiwiaW5zZXJ0IiwiYXNzZXJ0SGFzVmFsaWRGaWVsZE5hbWVzIiwiX3VzZU9JRCIsIk1vbmdvSUQiLCJPYmplY3RJRCIsIlJhbmRvbSIsImhhcyIsIl9zYXZlT3JpZ2luYWwiLCJxdWVyaWVzVG9SZWNvbXB1dGUiLCJfaW5zZXJ0SW5SZXN1bHRzIiwiX3JlY29tcHV0ZVJlc3VsdHMiLCJkZWZlciIsInBhdXNlT2JzZXJ2ZXJzIiwicmVtb3ZlIiwiZXF1YWxzIiwic2l6ZSIsIl9lYWNoUG9zc2libHlNYXRjaGluZ0RvYyIsInF1ZXJ5UmVtb3ZlIiwicmVtb3ZlSWQiLCJyZW1vdmVEb2MiLCJfcmVtb3ZlRnJvbVJlc3VsdHMiLCJyZXN1bWVPYnNlcnZlcnMiLCJfZGlmZlF1ZXJ5Q2hhbmdlcyIsInJldHJpZXZlT3JpZ2luYWxzIiwib3JpZ2luYWxzIiwic2F2ZU9yaWdpbmFscyIsInVwZGF0ZSIsInFpZFRvT3JpZ2luYWxSZXN1bHRzIiwiZG9jTWFwIiwiaWRzTWF0Y2hlZCIsIl9pZHNNYXRjaGVkQnlTZWxlY3RvciIsIm1lbW9pemVkQ2xvbmVJZk5lZWRlZCIsImRvY1RvTWVtb2l6ZSIsInJlY29tcHV0ZVFpZHMiLCJ1cGRhdGVDb3VudCIsInF1ZXJ5UmVzdWx0IiwiX21vZGlmeUFuZE5vdGlmeSIsIm11bHRpIiwiaW5zZXJ0ZWRJZCIsInVwc2VydCIsIl9jcmVhdGVVcHNlcnREb2N1bWVudCIsIl9yZXR1cm5PYmplY3QiLCJudW1iZXJBZmZlY3RlZCIsInNwZWNpZmljSWRzIiwibWF0Y2hlZF9iZWZvcmUiLCJvbGRfZG9jIiwiYWZ0ZXJNYXRjaCIsImFmdGVyIiwiYmVmb3JlIiwiX3VwZGF0ZUluUmVzdWx0cyIsIm9sZFJlc3VsdHMiLCJfQ2FjaGluZ0NoYW5nZU9ic2VydmVyIiwib3JkZXJlZEZyb21DYWxsYmFja3MiLCJjYWxsYmFja3MiLCJkb2NzIiwiT3JkZXJlZERpY3QiLCJpZFN0cmluZ2lmeSIsImFwcGx5Q2hhbmdlIiwicHV0QmVmb3JlIiwibW92ZUJlZm9yZSIsIkRpZmZTZXF1ZW5jZSIsImFwcGx5Q2hhbmdlcyIsIklkTWFwIiwiaWRQYXJzZSIsIl9fd3JhcHBlZFRyYW5zZm9ybV9fIiwid3JhcHBlZCIsInRyYW5zZm9ybWVkIiwibm9ucmVhY3RpdmUiLCJfYmluYXJ5U2VhcmNoIiwiY21wIiwiYXJyYXkiLCJmaXJzdCIsInJhbmdlIiwiaGFsZlJhbmdlIiwiZmxvb3IiLCJfY2hlY2tTdXBwb3J0ZWRQcm9qZWN0aW9uIiwiX2lkUHJvamVjdGlvbiIsInJ1bGVUcmVlIiwic3ViZG9jIiwic2VsZWN0b3JEb2N1bWVudCIsImlzTW9kaWZ5IiwiX2lzTW9kaWZpY2F0aW9uTW9kIiwibmV3RG9jIiwiaXNJbnNlcnQiLCJyZXBsYWNlbWVudCIsIl9kaWZmT2JqZWN0cyIsImxlZnQiLCJyaWdodCIsImRpZmZPYmplY3RzIiwibmV3UmVzdWx0cyIsIm9ic2VydmVyIiwiZGlmZlF1ZXJ5Q2hhbmdlcyIsIl9kaWZmUXVlcnlPcmRlcmVkQ2hhbmdlcyIsImRpZmZRdWVyeU9yZGVyZWRDaGFuZ2VzIiwiX2RpZmZRdWVyeVVub3JkZXJlZENoYW5nZXMiLCJkaWZmUXVlcnlVbm9yZGVyZWRDaGFuZ2VzIiwiX2ZpbmRJbk9yZGVyZWRSZXN1bHRzIiwic3ViSWRzIiwiX2luc2VydEluU29ydGVkTGlzdCIsInNwbGljZSIsImlzUmVwbGFjZSIsImlzTW9kaWZpZXIiLCJzZXRPbkluc2VydCIsIm1vZEZ1bmMiLCJNT0RJRklFUlMiLCJrZXlwYXRoIiwia2V5cGFydHMiLCJ0YXJnZXQiLCJmaW5kTW9kVGFyZ2V0IiwiZm9yYmlkQXJyYXkiLCJub0NyZWF0ZSIsIk5PX0NSRUFURV9NT0RJRklFUlMiLCJwb3AiLCJvYnNlcnZlQ2FsbGJhY2tzIiwic3VwcHJlc3NlZCIsIm9ic2VydmVDaGFuZ2VzQ2FsbGJhY2tzIiwiX29ic2VydmVDYWxsYmFja3NBcmVPcmRlcmVkIiwiaW5kaWNlcyIsIl9ub19pbmRpY2VzIiwiYWRkZWRBdCIsImNoYW5nZWRBdCIsIm9sZERvYyIsIm1vdmVkVG8iLCJmcm9tIiwidG8iLCJyZW1vdmVkQXQiLCJjaGFuZ2VPYnNlcnZlciIsImNoYW5nZWRGaWVsZHMiLCJtYWtlQ2hhbmdlZEZpZWxkcyIsIm9sZF9pZHgiLCJuZXdfaWR4IiwiJGN1cnJlbnREYXRlIiwiRGF0ZSIsIiRtaW4iLCIkbWF4IiwiJGluYyIsIiRzZXRPbkluc2VydCIsIiRwdXNoIiwiJGVhY2giLCJ0b1B1c2giLCJwb3NpdGlvbiIsIiRwb3NpdGlvbiIsIiRzbGljZSIsInNvcnRGdW5jdGlvbiIsIiRzb3J0Iiwic3BsaWNlQXJndW1lbnRzIiwiJHB1c2hBbGwiLCIkYWRkVG9TZXQiLCJpc0VhY2giLCJ2YWx1ZXMiLCJ0b0FkZCIsIiRwb3AiLCJ0b1BvcCIsIiRwdWxsIiwidG9QdWxsIiwib3V0IiwiJHB1bGxBbGwiLCIkcmVuYW1lIiwidGFyZ2V0MiIsIiRiaXQiLCJpbnZhbGlkQ2hhck1zZyIsIiQiLCJhc3NlcnRJc1ZhbGlkRmllbGROYW1lIiwidXNlZEFycmF5SW5kZXgiLCJsYXN0Iiwia2V5cGFydCIsInBhcnNlSW50IiwiaXNVcGRhdGUiLCJfZG9jTWF0Y2hlciIsIl9jb21waWxlU2VsZWN0b3IiLCJoYXNXaGVyZSIsImtleU9yZGVyU2Vuc2l0aXZlIiwiX3R5cGVvcmRlciIsInQiLCJ0YSIsInRiIiwib2EiLCJvYiIsInRvSGV4U3RyaW5nIiwiZ2V0VGltZSIsInRvQXJyYXkiLCJMb2NhbENvbGxlY3Rpb25fIiwic3BlYyIsIl9zb3J0U3BlY1BhcnRzIiwiX3NvcnRGdW5jdGlvbiIsImFkZFNwZWNQYXJ0IiwiYXNjZW5kaW5nIiwiY2hhckF0IiwibG9va3VwIiwiX2tleUNvbXBhcmF0b3IiLCJjb21wb3NlQ29tcGFyYXRvcnMiLCJfa2V5RmllbGRDb21wYXJhdG9yIiwiX2tleUZpbHRlciIsIl91c2VXaXRoTWF0Y2hlciIsIl9nZXRCYXNlQ29tcGFyYXRvciIsIl9jb21wYXJlS2V5cyIsImtleTEiLCJrZXkyIiwiX2dlbmVyYXRlS2V5c0Zyb21Eb2MiLCJjYiIsInBhdGhGcm9tSW5kaWNlcyIsImtub3duUGF0aHMiLCJ2YWx1ZXNCeUluZGV4QW5kUGF0aCIsInVzZWRQYXRocyIsInNvbGVLZXkiLCJkb2MxIiwiZG9jMiIsIl9nZXRNaW5LZXlGcm9tRG9jIiwibWluS2V5IiwiX2tleUNvbXBhdGlibGVXaXRoU2VsZWN0b3IiLCJpbnZlcnQiLCJjb21wYXJlIiwiY29uc3RyYWludHNCeVBhdGgiLCJjb25zdHJhaW50cyIsImlnbm9yZUNhc2UiLCJtdWx0aWxpbmUiLCJzcGVjUGFydCIsImNvbXBhcmF0b3JBcnJheSJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBQSxPQUFPQyxLQUFQLENBQWFDLFFBQVEsdUJBQVIsQ0FBYjtBQUErQyxJQUFJQyxNQUFKLEVBQVdDLFlBQVgsRUFBd0JDLGdCQUF4QixFQUF5Q0MsV0FBekMsRUFBcURDLGlCQUFyRDtBQUF1RVAsT0FBT0MsS0FBUCxDQUFhQyxRQUFRLGFBQVIsQ0FBYixFQUFvQztBQUFDQyxTQUFPSyxDQUFQLEVBQVM7QUFBQ0wsYUFBT0ssQ0FBUDtBQUFTLEdBQXBCOztBQUFxQkosZUFBYUksQ0FBYixFQUFlO0FBQUNKLG1CQUFhSSxDQUFiO0FBQWUsR0FBcEQ7O0FBQXFESCxtQkFBaUJHLENBQWpCLEVBQW1CO0FBQUNILHVCQUFpQkcsQ0FBakI7QUFBbUIsR0FBNUY7O0FBQTZGRixjQUFZRSxDQUFaLEVBQWM7QUFBQ0Ysa0JBQVlFLENBQVo7QUFBYyxHQUExSDs7QUFBMkhELG9CQUFrQkMsQ0FBbEIsRUFBb0I7QUFBQ0Qsd0JBQWtCQyxDQUFsQjtB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ZXMvbWluaW1vbmdvLmpzIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICcuL21pbmltb25nb19jb21tb24uanMnO1xuaW1wb3J0IHtcbiAgaGFzT3duLFxuICBpc051bWVyaWNLZXksXG4gIGlzT3BlcmF0b3JPYmplY3QsXG4gIHBhdGhzVG9UcmVlLFxuICBwcm9qZWN0aW9uRGV0YWlscyxcbn0gZnJvbSAnLi9jb21tb24uanMnO1xuXG5NaW5pbW9uZ28uX3BhdGhzRWxpZGluZ051bWVyaWNLZXlzID0gcGF0aHMgPT4gcGF0aHMubWFwKHBhdGggPT5cbiAgcGF0aC5zcGxpdCgnLicpLmZpbHRlcihwYXJ0ID0+ICFpc051bWVyaWNLZXkocGFydCkpLmpvaW4oJy4nKVxuKTtcblxuLy8gUmV0dXJucyB0cnVlIGlmIHRoZSBtb2RpZmllciBhcHBsaWVkIHRvIHNvbWUgZG9jdW1lbnQgbWF5IGNoYW5nZSB0aGUgcmVzdWx0XG4vLyBvZiBtYXRjaGluZyB0aGUgZG9jdW1lbnQgYnkgc2VsZWN0b3Jcbi8vIFRoZSBtb2RpZmllciBpcyBhbHdheXMgaW4gYSBmb3JtIG9mIE9iamVjdDpcbi8vICAtICRzZXRcbi8vICAgIC0gJ2EuYi4yMi56JzogdmFsdWVcbi8vICAgIC0gJ2Zvby5iYXInOiA0MlxuLy8gIC0gJHVuc2V0XG4vLyAgICAtICdhYmMuZCc6IDFcbk1pbmltb25nby5NYXRjaGVyLnByb3RvdHlwZS5hZmZlY3RlZEJ5TW9kaWZpZXIgPSBmdW5jdGlvbihtb2RpZmllcikge1xuICAvLyBzYWZlIGNoZWNrIGZvciAkc2V0LyR1bnNldCBiZWluZyBvYmplY3RzXG4gIG1vZGlmaWVyID0gT2JqZWN0LmFzc2lnbih7JHNldDoge30sICR1bnNldDoge319LCBtb2RpZmllcik7XG5cbiAgY29uc3QgbWVhbmluZ2Z1bFBhdGhzID0gdGhpcy5fZ2V0UGF0aHMoKTtcbiAgY29uc3QgbW9kaWZpZWRQYXRocyA9IFtdLmNvbmNhdChcbiAgICBPYmplY3Qua2V5cyhtb2RpZmllci4kc2V0KSxcbiAgICBPYmplY3Qua2V5cyhtb2RpZmllci4kdW5zZXQpXG4gICk7XG5cbiAgcmV0dXJuIG1vZGlmaWVkUGF0aHMuc29tZShwYXRoID0+IHtcbiAgICBjb25zdCBtb2QgPSBwYXRoLnNwbGl0KCcuJyk7XG5cbiAgICByZXR1cm4gbWVhbmluZ2Z1bFBhdGhzLnNvbWUobWVhbmluZ2Z1bFBhdGggPT4ge1xuICAgICAgY29uc3Qgc2VsID0gbWVhbmluZ2Z1bFBhdGguc3BsaXQoJy4nKTtcblxuICAgICAgbGV0IGkgPSAwLCBqID0gMDtcblxuICAgICAgd2hpbGUgKGkgPCBzZWwubGVuZ3RoICYmIGogPCBtb2QubGVuZ3RoKSB7XG4gICAgICAgIGlmIChpc051bWVyaWNLZXkoc2VsW2ldKSAmJiBpc051bWVyaWNLZXkobW9kW2pdKSkge1xuICAgICAgICAgIC8vIGZvby40LmJhciBzZWxlY3RvciBhZmZlY3RlZCBieSBmb28uNCBtb2RpZmllclxuICAgICAgICAgIC8vIGZvby4zLmJhciBzZWxlY3RvciB1bmFmZmVjdGVkIGJ5IGZvby40IG1vZGlmaWVyXG4gICAgICAgICAgaWYgKHNlbFtpXSA9PT0gbW9kW2pdKSB7XG4gICAgICAgICAgICBpKys7XG4gICAgICAgICAgICBqKys7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoaXNOdW1lcmljS2V5KHNlbFtpXSkpIHtcbiAgICAgICAgICAvLyBmb28uNC5iYXIgc2VsZWN0b3IgdW5hZmZlY3RlZCBieSBmb28uYmFyIG1vZGlmaWVyXG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9IGVsc2UgaWYgKGlzTnVtZXJpY0tleShtb2Rbal0pKSB7XG4gICAgICAgICAgaisrO1xuICAgICAgICB9IGVsc2UgaWYgKHNlbFtpXSA9PT0gbW9kW2pdKSB7XG4gICAgICAgICAgaSsrO1xuICAgICAgICAgIGorKztcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gT25lIGlzIGEgcHJlZml4IG9mIGFub3RoZXIsIHRha2luZyBudW1lcmljIGZpZWxkcyBpbnRvIGFjY291bnRcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH0pO1xuICB9KTtcbn07XG5cbi8vIEBwYXJhbSBtb2RpZmllciAtIE9iamVjdDogTW9uZ29EQi1zdHlsZWQgbW9kaWZpZXIgd2l0aCBgJHNldGBzIGFuZCBgJHVuc2V0c2Bcbi8vICAgICAgICAgICAgICAgICAgICAgICAgICAgb25seS4gKGFzc3VtZWQgdG8gY29tZSBmcm9tIG9wbG9nKVxuLy8gQHJldHVybnMgLSBCb29sZWFuOiBpZiBhZnRlciBhcHBseWluZyB0aGUgbW9kaWZpZXIsIHNlbGVjdG9yIGNhbiBzdGFydFxuLy8gICAgICAgICAgICAgICAgICAgICBhY2NlcHRpbmcgdGhlIG1vZGlmaWVkIHZhbHVlLlxuLy8gTk9URTogYXNzdW1lcyB0aGF0IGRvY3VtZW50IGFmZmVjdGVkIGJ5IG1vZGlmaWVyIGRpZG4ndCBtYXRjaCB0aGlzIE1hdGNoZXJcbi8vIGJlZm9yZSwgc28gaWYgbW9kaWZpZXIgY2FuJ3QgY29udmluY2Ugc2VsZWN0b3IgaW4gYSBwb3NpdGl2ZSBjaGFuZ2UgaXQgd291bGRcbi8vIHN0YXkgJ2ZhbHNlJy5cbi8vIEN1cnJlbnRseSBkb2Vzbid0IHN1cHBvcnQgJC1vcGVyYXRvcnMgYW5kIG51bWVyaWMgaW5kaWNlcyBwcmVjaXNlbHkuXG5NaW5pbW9uZ28uTWF0Y2hlci5wcm90b3R5cGUuY2FuQmVjb21lVHJ1ZUJ5TW9kaWZpZXIgPSBmdW5jdGlvbihtb2RpZmllcikge1xuICBpZiAoIXRoaXMuYWZmZWN0ZWRCeU1vZGlmaWVyKG1vZGlmaWVyKSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGlmICghdGhpcy5pc1NpbXBsZSgpKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICBtb2RpZmllciA9IE9iamVjdC5hc3NpZ24oeyRzZXQ6IHt9LCAkdW5zZXQ6IHt9fSwgbW9kaWZpZXIpO1xuXG4gIGNvbnN0IG1vZGlmaWVyUGF0aHMgPSBbXS5jb25jYXQoXG4gICAgT2JqZWN0LmtleXMobW9kaWZpZXIuJHNldCksXG4gICAgT2JqZWN0LmtleXMobW9kaWZpZXIuJHVuc2V0KVxuICApO1xuXG4gIGlmICh0aGlzLl9nZXRQYXRocygpLnNvbWUocGF0aEhhc051bWVyaWNLZXlzKSB8fFxuICAgICAgbW9kaWZpZXJQYXRocy5zb21lKHBhdGhIYXNOdW1lcmljS2V5cykpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIC8vIGNoZWNrIGlmIHRoZXJlIGlzIGEgJHNldCBvciAkdW5zZXQgdGhhdCBpbmRpY2F0ZXMgc29tZXRoaW5nIGlzIGFuXG4gIC8vIG9iamVjdCByYXRoZXIgdGhhbiBhIHNjYWxhciBpbiB0aGUgYWN0dWFsIG9iamVjdCB3aGVyZSB3ZSBzYXcgJC1vcGVyYXRvclxuICAvLyBOT1RFOiBpdCBpcyBjb3JyZWN0IHNpbmNlIHdlIGFsbG93IG9ubHkgc2NhbGFycyBpbiAkLW9wZXJhdG9yc1xuICAvLyBFeGFtcGxlOiBmb3Igc2VsZWN0b3IgeydhLmInOiB7JGd0OiA1fX0gdGhlIG1vZGlmaWVyIHsnYS5iLmMnOjd9IHdvdWxkXG4gIC8vIGRlZmluaXRlbHkgc2V0IHRoZSByZXN1bHQgdG8gZmFsc2UgYXMgJ2EuYicgYXBwZWFycyB0byBiZSBhbiBvYmplY3QuXG4gIGNvbnN0IGV4cGVjdGVkU2NhbGFySXNPYmplY3QgPSBPYmplY3Qua2V5cyh0aGlzLl9zZWxlY3Rvcikuc29tZShwYXRoID0+IHtcbiAgICBpZiAoIWlzT3BlcmF0b3JPYmplY3QodGhpcy5fc2VsZWN0b3JbcGF0aF0pKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgcmV0dXJuIG1vZGlmaWVyUGF0aHMuc29tZShtb2RpZmllclBhdGggPT5cbiAgICAgIG1vZGlmaWVyUGF0aC5zdGFydHNXaXRoKGAke3BhdGh9LmApXG4gICAgKTtcbiAgfSk7XG5cbiAgaWYgKGV4cGVjdGVkU2NhbGFySXNPYmplY3QpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICAvLyBTZWUgaWYgd2UgY2FuIGFwcGx5IHRoZSBtb2RpZmllciBvbiB0aGUgaWRlYWxseSBtYXRjaGluZyBvYmplY3QuIElmIGl0XG4gIC8vIHN0aWxsIG1hdGNoZXMgdGhlIHNlbGVjdG9yLCB0aGVuIHRoZSBtb2RpZmllciBjb3VsZCBoYXZlIHR1cm5lZCB0aGUgcmVhbFxuICAvLyBvYmplY3QgaW4gdGhlIGRhdGFiYXNlIGludG8gc29tZXRoaW5nIG1hdGNoaW5nLlxuICBjb25zdCBtYXRjaGluZ0RvY3VtZW50ID0gRUpTT04uY2xvbmUodGhpcy5tYXRjaGluZ0RvY3VtZW50KCkpO1xuXG4gIC8vIFRoZSBzZWxlY3RvciBpcyB0b28gY29tcGxleCwgYW55dGhpbmcgY2FuIGhhcHBlbi5cbiAgaWYgKG1hdGNoaW5nRG9jdW1lbnQgPT09IG51bGwpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIHRyeSB7XG4gICAgTG9jYWxDb2xsZWN0aW9uLl9tb2RpZnkobWF0Y2hpbmdEb2N1bWVudCwgbW9kaWZpZXIpO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIC8vIENvdWxkbid0IHNldCBhIHByb3BlcnR5IG9uIGEgZmllbGQgd2hpY2ggaXMgYSBzY2FsYXIgb3IgbnVsbCBpbiB0aGVcbiAgICAvLyBzZWxlY3Rvci5cbiAgICAvLyBFeGFtcGxlOlxuICAgIC8vIHJlYWwgZG9jdW1lbnQ6IHsgJ2EuYic6IDMgfVxuICAgIC8vIHNlbGVjdG9yOiB7ICdhJzogMTIgfVxuICAgIC8vIGNvbnZlcnRlZCBzZWxlY3RvciAoaWRlYWwgZG9jdW1lbnQpOiB7ICdhJzogMTIgfVxuICAgIC8vIG1vZGlmaWVyOiB7ICRzZXQ6IHsgJ2EuYic6IDQgfSB9XG4gICAgLy8gV2UgZG9uJ3Qga25vdyB3aGF0IHJlYWwgZG9jdW1lbnQgd2FzIGxpa2UgYnV0IGZyb20gdGhlIGVycm9yIHJhaXNlZCBieVxuICAgIC8vICRzZXQgb24gYSBzY2FsYXIgZmllbGQgd2UgY2FuIHJlYXNvbiB0aGF0IHRoZSBzdHJ1Y3R1cmUgb2YgcmVhbCBkb2N1bWVudFxuICAgIC8vIGlzIGNvbXBsZXRlbHkgZGlmZmVyZW50LlxuICAgIGlmIChlcnJvci5uYW1lID09PSAnTWluaW1vbmdvRXJyb3InICYmIGVycm9yLnNldFByb3BlcnR5RXJyb3IpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICB0aHJvdyBlcnJvcjtcbiAgfVxuXG4gIHJldHVybiB0aGlzLmRvY3VtZW50TWF0Y2hlcyhtYXRjaGluZ0RvY3VtZW50KS5yZXN1bHQ7XG59O1xuXG4vLyBLbm93cyBob3cgdG8gY29tYmluZSBhIG1vbmdvIHNlbGVjdG9yIGFuZCBhIGZpZWxkcyBwcm9qZWN0aW9uIHRvIGEgbmV3IGZpZWxkc1xuLy8gcHJvamVjdGlvbiB0YWtpbmcgaW50byBhY2NvdW50IGFjdGl2ZSBmaWVsZHMgZnJvbSB0aGUgcGFzc2VkIHNlbGVjdG9yLlxuLy8gQHJldHVybnMgT2JqZWN0IC0gcHJvamVjdGlvbiBvYmplY3QgKHNhbWUgYXMgZmllbGRzIG9wdGlvbiBvZiBtb25nbyBjdXJzb3IpXG5NaW5pbW9uZ28uTWF0Y2hlci5wcm90b3R5cGUuY29tYmluZUludG9Qcm9qZWN0aW9uID0gZnVuY3Rpb24ocHJvamVjdGlvbikge1xuICBjb25zdCBzZWxlY3RvclBhdGhzID0gTWluaW1vbmdvLl9wYXRoc0VsaWRpbmdOdW1lcmljS2V5cyh0aGlzLl9nZXRQYXRocygpKTtcblxuICAvLyBTcGVjaWFsIGNhc2UgZm9yICR3aGVyZSBvcGVyYXRvciBpbiB0aGUgc2VsZWN0b3IgLSBwcm9qZWN0aW9uIHNob3VsZCBkZXBlbmRcbiAgLy8gb24gYWxsIGZpZWxkcyBvZiB0aGUgZG9jdW1lbnQuIGdldFNlbGVjdG9yUGF0aHMgcmV0dXJucyBhIGxpc3Qgb2YgcGF0aHNcbiAgLy8gc2VsZWN0b3IgZGVwZW5kcyBvbi4gSWYgb25lIG9mIHRoZSBwYXRocyBpcyAnJyAoZW1wdHkgc3RyaW5nKSByZXByZXNlbnRpbmdcbiAgLy8gdGhlIHJvb3Qgb3IgdGhlIHdob2xlIGRvY3VtZW50LCBjb21wbGV0ZSBwcm9qZWN0aW9uIHNob3VsZCBiZSByZXR1cm5lZC5cbiAgaWYgKHNlbGVjdG9yUGF0aHMuaW5jbHVkZXMoJycpKSB7XG4gICAgcmV0dXJuIHt9O1xuICB9XG5cbiAgcmV0dXJuIGNvbWJpbmVJbXBvcnRhbnRQYXRoc0ludG9Qcm9qZWN0aW9uKHNlbGVjdG9yUGF0aHMsIHByb2plY3Rpb24pO1xufTtcblxuLy8gUmV0dXJucyBhbiBvYmplY3QgdGhhdCB3b3VsZCBtYXRjaCB0aGUgc2VsZWN0b3IgaWYgcG9zc2libGUgb3IgbnVsbCBpZiB0aGVcbi8vIHNlbGVjdG9yIGlzIHRvbyBjb21wbGV4IGZvciB1cyB0byBhbmFseXplXG4vLyB7ICdhLmInOiB7IGFuczogNDIgfSwgJ2Zvby5iYXInOiBudWxsLCAnZm9vLmJheic6IFwic29tZXRoaW5nXCIgfVxuLy8gPT4geyBhOiB7IGI6IHsgYW5zOiA0MiB9IH0sIGZvbzogeyBiYXI6IG51bGwsIGJhejogXCJzb21ldGhpbmdcIiB9IH1cbk1pbmltb25nby5NYXRjaGVyLnByb3RvdHlwZS5tYXRjaGluZ0RvY3VtZW50ID0gZnVuY3Rpb24oKSB7XG4gIC8vIGNoZWNrIGlmIGl0IHdhcyBjb21wdXRlZCBiZWZvcmVcbiAgaWYgKHRoaXMuX21hdGNoaW5nRG9jdW1lbnQgIT09IHVuZGVmaW5lZCkge1xuICAgIHJldHVybiB0aGlzLl9tYXRjaGluZ0RvY3VtZW50O1xuICB9XG5cbiAgLy8gSWYgdGhlIGFuYWx5c2lzIG9mIHRoaXMgc2VsZWN0b3IgaXMgdG9vIGhhcmQgZm9yIG91ciBpbXBsZW1lbnRhdGlvblxuICAvLyBmYWxsYmFjayB0byBcIllFU1wiXG4gIGxldCBmYWxsYmFjayA9IGZhbHNlO1xuXG4gIHRoaXMuX21hdGNoaW5nRG9jdW1lbnQgPSBwYXRoc1RvVHJlZShcbiAgICB0aGlzLl9nZXRQYXRocygpLFxuICAgIHBhdGggPT4ge1xuICAgICAgY29uc3QgdmFsdWVTZWxlY3RvciA9IHRoaXMuX3NlbGVjdG9yW3BhdGhdO1xuXG4gICAgICBpZiAoaXNPcGVyYXRvck9iamVjdCh2YWx1ZVNlbGVjdG9yKSkge1xuICAgICAgICAvLyBpZiB0aGVyZSBpcyBhIHN0cmljdCBlcXVhbGl0eSwgdGhlcmUgaXMgYSBnb29kXG4gICAgICAgIC8vIGNoYW5jZSB3ZSBjYW4gdXNlIG9uZSBvZiB0aG9zZSBhcyBcIm1hdGNoaW5nXCJcbiAgICAgICAgLy8gZHVtbXkgdmFsdWVcbiAgICAgICAgaWYgKHZhbHVlU2VsZWN0b3IuJGVxKSB7XG4gICAgICAgICAgcmV0dXJuIHZhbHVlU2VsZWN0b3IuJGVxO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHZhbHVlU2VsZWN0b3IuJGluKSB7XG4gICAgICAgICAgY29uc3QgbWF0Y2hlciA9IG5ldyBNaW5pbW9uZ28uTWF0Y2hlcih7cGxhY2Vob2xkZXI6IHZhbHVlU2VsZWN0b3J9KTtcblxuICAgICAgICAgIC8vIFJldHVybiBhbnl0aGluZyBmcm9tICRpbiB0aGF0IG1hdGNoZXMgdGhlIHdob2xlIHNlbGVjdG9yIGZvciB0aGlzXG4gICAgICAgICAgLy8gcGF0aC4gSWYgbm90aGluZyBtYXRjaGVzLCByZXR1cm5zIGB1bmRlZmluZWRgIGFzIG5vdGhpbmcgY2FuIG1ha2VcbiAgICAgICAgICAvLyB0aGlzIHNlbGVjdG9yIGludG8gYHRydWVgLlxuICAgICAgICAgIHJldHVybiB2YWx1ZVNlbGVjdG9yLiRpbi5maW5kKHBsYWNlaG9sZGVyID0+XG4gICAgICAgICAgICBtYXRjaGVyLmRvY3VtZW50TWF0Y2hlcyh7cGxhY2Vob2xkZXJ9KS5yZXN1bHRcbiAgICAgICAgICApO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKG9ubHlDb250YWluc0tleXModmFsdWVTZWxlY3RvciwgWyckZ3QnLCAnJGd0ZScsICckbHQnLCAnJGx0ZSddKSkge1xuICAgICAgICAgIGxldCBsb3dlckJvdW5kID0gLUluZmluaXR5O1xuICAgICAgICAgIGxldCB1cHBlckJvdW5kID0gSW5maW5pdHk7XG5cbiAgICAgICAgICBbJyRsdGUnLCAnJGx0J10uZm9yRWFjaChvcCA9PiB7XG4gICAgICAgICAgICBpZiAoaGFzT3duLmNhbGwodmFsdWVTZWxlY3Rvciwgb3ApICYmXG4gICAgICAgICAgICAgICAgdmFsdWVTZWxlY3RvcltvcF0gPCB1cHBlckJvdW5kKSB7XG4gICAgICAgICAgICAgIHVwcGVyQm91bmQgPSB2YWx1ZVNlbGVjdG9yW29wXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcblxuICAgICAgICAgIFsnJGd0ZScsICckZ3QnXS5mb3JFYWNoKG9wID0+IHtcbiAgICAgICAgICAgIGlmIChoYXNPd24uY2FsbCh2YWx1ZVNlbGVjdG9yLCBvcCkgJiZcbiAgICAgICAgICAgICAgICB2YWx1ZVNlbGVjdG9yW29wXSA+IGxvd2VyQm91bmQpIHtcbiAgICAgICAgICAgICAgbG93ZXJCb3VuZCA9IHZhbHVlU2VsZWN0b3Jbb3BdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgY29uc3QgbWlkZGxlID0gKGxvd2VyQm91bmQgKyB1cHBlckJvdW5kKSAvIDI7XG4gICAgICAgICAgY29uc3QgbWF0Y2hlciA9IG5ldyBNaW5pbW9uZ28uTWF0Y2hlcih7cGxhY2Vob2xkZXI6IHZhbHVlU2VsZWN0b3J9KTtcblxuICAgICAgICAgIGlmICghbWF0Y2hlci5kb2N1bWVudE1hdGNoZXMoe3BsYWNlaG9sZGVyOiBtaWRkbGV9KS5yZXN1bHQgJiZcbiAgICAgICAgICAgICAgKG1pZGRsZSA9PT0gbG93ZXJCb3VuZCB8fCBtaWRkbGUgPT09IHVwcGVyQm91bmQpKSB7XG4gICAgICAgICAgICBmYWxsYmFjayA9IHRydWU7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmV0dXJuIG1pZGRsZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChvbmx5Q29udGFpbnNLZXlzKHZhbHVlU2VsZWN0b3IsIFsnJG5pbicsICckbmUnXSkpIHtcbiAgICAgICAgICAvLyBTaW5jZSB0aGlzLl9pc1NpbXBsZSBtYWtlcyBzdXJlICRuaW4gYW5kICRuZSBhcmUgbm90IGNvbWJpbmVkIHdpdGhcbiAgICAgICAgICAvLyBvYmplY3RzIG9yIGFycmF5cywgd2UgY2FuIGNvbmZpZGVudGx5IHJldHVybiBhbiBlbXB0eSBvYmplY3QgYXMgaXRcbiAgICAgICAgICAvLyBuZXZlciBtYXRjaGVzIGFueSBzY2FsYXIuXG4gICAgICAgICAgcmV0dXJuIHt9O1xuICAgICAgICB9XG5cbiAgICAgICAgZmFsbGJhY2sgPSB0cnVlO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gdGhpcy5fc2VsZWN0b3JbcGF0aF07XG4gICAgfSxcbiAgICB4ID0+IHgpO1xuXG4gIGlmIChmYWxsYmFjaykge1xuICAgIHRoaXMuX21hdGNoaW5nRG9jdW1lbnQgPSBudWxsO1xuICB9XG5cbiAgcmV0dXJuIHRoaXMuX21hdGNoaW5nRG9jdW1lbnQ7XG59O1xuXG4vLyBNaW5pbW9uZ28uU29ydGVyIGdldHMgYSBzaW1pbGFyIG1ldGhvZCwgd2hpY2ggZGVsZWdhdGVzIHRvIGEgTWF0Y2hlciBpdCBtYWRlXG4vLyBmb3IgdGhpcyBleGFjdCBwdXJwb3NlLlxuTWluaW1vbmdvLlNvcnRlci5wcm90b3R5cGUuYWZmZWN0ZWRCeU1vZGlmaWVyID0gZnVuY3Rpb24obW9kaWZpZXIpIHtcbiAgcmV0dXJuIHRoaXMuX3NlbGVjdG9yRm9yQWZmZWN0ZWRCeU1vZGlmaWVyLmFmZmVjdGVkQnlNb2RpZmllcihtb2RpZmllcik7XG59O1xuXG5NaW5pbW9uZ28uU29ydGVyLnByb3RvdHlwZS5jb21iaW5lSW50b1Byb2plY3Rpb24gPSBmdW5jdGlvbihwcm9qZWN0aW9uKSB7XG4gIHJldHVybiBjb21iaW5lSW1wb3J0YW50UGF0aHNJbnRvUHJvamVjdGlvbihcbiAgICBNaW5pbW9uZ28uX3BhdGhzRWxpZGluZ051bWVyaWNLZXlzKHRoaXMuX2dldFBhdGhzKCkpLFxuICAgIHByb2plY3Rpb25cbiAgKTtcbn07XG5cbmZ1bmN0aW9uIGNvbWJpbmVJbXBvcnRhbnRQYXRoc0ludG9Qcm9qZWN0aW9uKHBhdGhzLCBwcm9qZWN0aW9uKSB7XG4gIGNvbnN0IGRldGFpbHMgPSBwcm9qZWN0aW9uRGV0YWlscyhwcm9qZWN0aW9uKTtcblxuICAvLyBtZXJnZSB0aGUgcGF0aHMgdG8gaW5jbHVkZVxuICBjb25zdCB0cmVlID0gcGF0aHNUb1RyZWUoXG4gICAgcGF0aHMsXG4gICAgcGF0aCA9PiB0cnVlLFxuICAgIChub2RlLCBwYXRoLCBmdWxsUGF0aCkgPT4gdHJ1ZSxcbiAgICBkZXRhaWxzLnRyZWVcbiAgKTtcbiAgY29uc3QgbWVyZ2VkUHJvamVjdGlvbiA9IHRyZWVUb1BhdGhzKHRyZWUpO1xuXG4gIGlmIChkZXRhaWxzLmluY2x1ZGluZykge1xuICAgIC8vIGJvdGggc2VsZWN0b3IgYW5kIHByb2plY3Rpb24gYXJlIHBvaW50aW5nIG9uIGZpZWxkcyB0byBpbmNsdWRlXG4gICAgLy8gc28gd2UgY2FuIGp1c3QgcmV0dXJuIHRoZSBtZXJnZWQgdHJlZVxuICAgIHJldHVybiBtZXJnZWRQcm9qZWN0aW9uO1xuICB9XG5cbiAgLy8gc2VsZWN0b3IgaXMgcG9pbnRpbmcgYXQgZmllbGRzIHRvIGluY2x1ZGVcbiAgLy8gcHJvamVjdGlvbiBpcyBwb2ludGluZyBhdCBmaWVsZHMgdG8gZXhjbHVkZVxuICAvLyBtYWtlIHN1cmUgd2UgZG9uJ3QgZXhjbHVkZSBpbXBvcnRhbnQgcGF0aHNcbiAgY29uc3QgbWVyZ2VkRXhjbFByb2plY3Rpb24gPSB7fTtcblxuICBPYmplY3Qua2V5cyhtZXJnZWRQcm9qZWN0aW9uKS5mb3JFYWNoKHBhdGggPT4ge1xuICAgIGlmICghbWVyZ2VkUHJvamVjdGlvbltwYXRoXSkge1xuICAgICAgbWVyZ2VkRXhjbFByb2plY3Rpb25bcGF0aF0gPSBmYWxzZTtcbiAgICB9XG4gIH0pO1xuXG4gIHJldHVybiBtZXJnZWRFeGNsUHJvamVjdGlvbjtcbn1cblxuZnVuY3Rpb24gZ2V0UGF0aHMoc2VsZWN0b3IpIHtcbiAgcmV0dXJuIE9iamVjdC5rZXlzKG5ldyBNaW5pbW9uZ28uTWF0Y2hlcihzZWxlY3RvcikuX3BhdGhzKTtcblxuICAvLyBYWFggcmVtb3ZlIGl0P1xuICAvLyByZXR1cm4gT2JqZWN0LmtleXMoc2VsZWN0b3IpLm1hcChrID0+IHtcbiAgLy8gICAvLyB3ZSBkb24ndCBrbm93IGhvdyB0byBoYW5kbGUgJHdoZXJlIGJlY2F1c2UgaXQgY2FuIGJlIGFueXRoaW5nXG4gIC8vICAgaWYgKGsgPT09ICckd2hlcmUnKSB7XG4gIC8vICAgICByZXR1cm4gJyc7IC8vIG1hdGNoZXMgZXZlcnl0aGluZ1xuICAvLyAgIH1cblxuICAvLyAgIC8vIHdlIGJyYW5jaCBmcm9tICRvci8kYW5kLyRub3Igb3BlcmF0b3JcbiAgLy8gICBpZiAoWyckb3InLCAnJGFuZCcsICckbm9yJ10uaW5jbHVkZXMoaykpIHtcbiAgLy8gICAgIHJldHVybiBzZWxlY3RvcltrXS5tYXAoZ2V0UGF0aHMpO1xuICAvLyAgIH1cblxuICAvLyAgIC8vIHRoZSB2YWx1ZSBpcyBhIGxpdGVyYWwgb3Igc29tZSBjb21wYXJpc29uIG9wZXJhdG9yXG4gIC8vICAgcmV0dXJuIGs7XG4gIC8vIH0pXG4gIC8vICAgLnJlZHVjZSgoYSwgYikgPT4gYS5jb25jYXQoYiksIFtdKVxuICAvLyAgIC5maWx0ZXIoKGEsIGIsIGMpID0+IGMuaW5kZXhPZihhKSA9PT0gYik7XG59XG5cbi8vIEEgaGVscGVyIHRvIGVuc3VyZSBvYmplY3QgaGFzIG9ubHkgY2VydGFpbiBrZXlzXG5mdW5jdGlvbiBvbmx5Q29udGFpbnNLZXlzKG9iaiwga2V5cykge1xuICByZXR1cm4gT2JqZWN0LmtleXMob2JqKS5ldmVyeShrID0+IGtleXMuaW5jbHVkZXMoaykpO1xufVxuXG5mdW5jdGlvbiBwYXRoSGFzTnVtZXJpY0tleXMocGF0aCkge1xuICByZXR1cm4gcGF0aC5zcGxpdCgnLicpLnNvbWUoaXNOdW1lcmljS2V5KTtcbn1cblxuLy8gUmV0dXJucyBhIHNldCBvZiBrZXkgcGF0aHMgc2ltaWxhciB0b1xuLy8geyAnZm9vLmJhcic6IDEsICdhLmIuYyc6IDEgfVxuZnVuY3Rpb24gdHJlZVRvUGF0aHModHJlZSwgcHJlZml4ID0gJycpIHtcbiAgY29uc3QgcmVzdWx0ID0ge307XG5cbiAgT2JqZWN0LmtleXModHJlZSkuZm9yRWFjaChrZXkgPT4ge1xuICAgIGNvbnN0IHZhbHVlID0gdHJlZVtrZXldO1xuICAgIGlmICh2YWx1ZSA9PT0gT2JqZWN0KHZhbHVlKSkge1xuICAgICAgT2JqZWN0LmFzc2lnbihyZXN1bHQsIHRyZWVUb1BhdGhzKHZhbHVlLCBgJHtwcmVmaXggKyBrZXl9LmApKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmVzdWx0W3ByZWZpeCArIGtleV0gPSB2YWx1ZTtcbiAgICB9XG4gIH0pO1xuXG4gIHJldHVybiByZXN1bHQ7XG59XG4iLCJpbXBvcnQgTG9jYWxDb2xsZWN0aW9uIGZyb20gJy4vbG9jYWxfY29sbGVjdGlvbi5qcyc7XG5cbmV4cG9ydCBjb25zdCBoYXNPd24gPSBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5O1xuXG4vLyBFYWNoIGVsZW1lbnQgc2VsZWN0b3IgY29udGFpbnM6XG4vLyAgLSBjb21waWxlRWxlbWVudFNlbGVjdG9yLCBhIGZ1bmN0aW9uIHdpdGggYXJnczpcbi8vICAgIC0gb3BlcmFuZCAtIHRoZSBcInJpZ2h0IGhhbmQgc2lkZVwiIG9mIHRoZSBvcGVyYXRvclxuLy8gICAgLSB2YWx1ZVNlbGVjdG9yIC0gdGhlIFwiY29udGV4dFwiIGZvciB0aGUgb3BlcmF0b3IgKHNvIHRoYXQgJHJlZ2V4IGNhbiBmaW5kXG4vLyAgICAgICRvcHRpb25zKVxuLy8gICAgLSBtYXRjaGVyIC0gdGhlIE1hdGNoZXIgdGhpcyBpcyBnb2luZyBpbnRvIChzbyB0aGF0ICRlbGVtTWF0Y2ggY2FuIGNvbXBpbGVcbi8vICAgICAgbW9yZSB0aGluZ3MpXG4vLyAgICByZXR1cm5pbmcgYSBmdW5jdGlvbiBtYXBwaW5nIGEgc2luZ2xlIHZhbHVlIHRvIGJvb2wuXG4vLyAgLSBkb250RXhwYW5kTGVhZkFycmF5cywgYSBib29sIHdoaWNoIHByZXZlbnRzIGV4cGFuZEFycmF5c0luQnJhbmNoZXMgZnJvbVxuLy8gICAgYmVpbmcgY2FsbGVkXG4vLyAgLSBkb250SW5jbHVkZUxlYWZBcnJheXMsIGEgYm9vbCB3aGljaCBjYXVzZXMgYW4gYXJndW1lbnQgdG8gYmUgcGFzc2VkIHRvXG4vLyAgICBleHBhbmRBcnJheXNJbkJyYW5jaGVzIGlmIGl0IGlzIGNhbGxlZFxuZXhwb3J0IGNvbnN0IEVMRU1FTlRfT1BFUkFUT1JTID0ge1xuICAkbHQ6IG1ha2VJbmVxdWFsaXR5KGNtcFZhbHVlID0+IGNtcFZhbHVlIDwgMCksXG4gICRndDogbWFrZUluZXF1YWxpdHkoY21wVmFsdWUgPT4gY21wVmFsdWUgPiAwKSxcbiAgJGx0ZTogbWFrZUluZXF1YWxpdHkoY21wVmFsdWUgPT4gY21wVmFsdWUgPD0gMCksXG4gICRndGU6IG1ha2VJbmVxdWFsaXR5KGNtcFZhbHVlID0+IGNtcFZhbHVlID49IDApLFxuICAkbW9kOiB7XG4gICAgY29tcGlsZUVsZW1lbnRTZWxlY3RvcihvcGVyYW5kKSB7XG4gICAgICBpZiAoIShBcnJheS5pc0FycmF5KG9wZXJhbmQpICYmIG9wZXJhbmQubGVuZ3RoID09PSAyXG4gICAgICAgICAgICAmJiB0eXBlb2Ygb3BlcmFuZFswXSA9PT0gJ251bWJlcidcbiAgICAgICAgICAgICYmIHR5cGVvZiBvcGVyYW5kWzFdID09PSAnbnVtYmVyJykpIHtcbiAgICAgICAgdGhyb3cgRXJyb3IoJ2FyZ3VtZW50IHRvICRtb2QgbXVzdCBiZSBhbiBhcnJheSBvZiB0d28gbnVtYmVycycpO1xuICAgICAgfVxuXG4gICAgICAvLyBYWFggY291bGQgcmVxdWlyZSB0byBiZSBpbnRzIG9yIHJvdW5kIG9yIHNvbWV0aGluZ1xuICAgICAgY29uc3QgZGl2aXNvciA9IG9wZXJhbmRbMF07XG4gICAgICBjb25zdCByZW1haW5kZXIgPSBvcGVyYW5kWzFdO1xuICAgICAgcmV0dXJuIHZhbHVlID0+IChcbiAgICAgICAgdHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJyAmJiB2YWx1ZSAlIGRpdmlzb3IgPT09IHJlbWFpbmRlclxuICAgICAgKTtcbiAgICB9LFxuICB9LFxuICAkaW46IHtcbiAgICBjb21waWxlRWxlbWVudFNlbGVjdG9yKG9wZXJhbmQpIHtcbiAgICAgIGlmICghQXJyYXkuaXNBcnJheShvcGVyYW5kKSkge1xuICAgICAgICB0aHJvdyBFcnJvcignJGluIG5lZWRzIGFuIGFycmF5Jyk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGVsZW1lbnRNYXRjaGVycyA9IG9wZXJhbmQubWFwKG9wdGlvbiA9PiB7XG4gICAgICAgIGlmIChvcHRpb24gaW5zdGFuY2VvZiBSZWdFeHApIHtcbiAgICAgICAgICByZXR1cm4gcmVnZXhwRWxlbWVudE1hdGNoZXIob3B0aW9uKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChpc09wZXJhdG9yT2JqZWN0KG9wdGlvbikpIHtcbiAgICAgICAgICB0aHJvdyBFcnJvcignY2Fubm90IG5lc3QgJCB1bmRlciAkaW4nKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBlcXVhbGl0eUVsZW1lbnRNYXRjaGVyKG9wdGlvbik7XG4gICAgICB9KTtcblxuICAgICAgcmV0dXJuIHZhbHVlID0+IHtcbiAgICAgICAgLy8gQWxsb3cge2E6IHskaW46IFtudWxsXX19IHRvIG1hdGNoIHdoZW4gJ2EnIGRvZXMgbm90IGV4aXN0LlxuICAgICAgICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHZhbHVlID0gbnVsbDtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBlbGVtZW50TWF0Y2hlcnMuc29tZShtYXRjaGVyID0+IG1hdGNoZXIodmFsdWUpKTtcbiAgICAgIH07XG4gICAgfSxcbiAgfSxcbiAgJHNpemU6IHtcbiAgICAvLyB7YTogW1s1LCA1XV19IG11c3QgbWF0Y2gge2E6IHskc2l6ZTogMX19IGJ1dCBub3Qge2E6IHskc2l6ZTogMn19LCBzbyB3ZVxuICAgIC8vIGRvbid0IHdhbnQgdG8gY29uc2lkZXIgdGhlIGVsZW1lbnQgWzUsNV0gaW4gdGhlIGxlYWYgYXJyYXkgW1s1LDVdXSBhcyBhXG4gICAgLy8gcG9zc2libGUgdmFsdWUuXG4gICAgZG9udEV4cGFuZExlYWZBcnJheXM6IHRydWUsXG4gICAgY29tcGlsZUVsZW1lbnRTZWxlY3RvcihvcGVyYW5kKSB7XG4gICAgICBpZiAodHlwZW9mIG9wZXJhbmQgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIC8vIERvbid0IGFzayBtZSB3aHksIGJ1dCBieSBleHBlcmltZW50YXRpb24sIHRoaXMgc2VlbXMgdG8gYmUgd2hhdCBNb25nb1xuICAgICAgICAvLyBkb2VzLlxuICAgICAgICBvcGVyYW5kID0gMDtcbiAgICAgIH0gZWxzZSBpZiAodHlwZW9mIG9wZXJhbmQgIT09ICdudW1iZXInKSB7XG4gICAgICAgIHRocm93IEVycm9yKCckc2l6ZSBuZWVkcyBhIG51bWJlcicpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gdmFsdWUgPT4gQXJyYXkuaXNBcnJheSh2YWx1ZSkgJiYgdmFsdWUubGVuZ3RoID09PSBvcGVyYW5kO1xuICAgIH0sXG4gIH0sXG4gICR0eXBlOiB7XG4gICAgLy8ge2E6IFs1XX0gbXVzdCBub3QgbWF0Y2gge2E6IHskdHlwZTogNH19ICg0IG1lYW5zIGFycmF5KSwgYnV0IGl0IHNob3VsZFxuICAgIC8vIG1hdGNoIHthOiB7JHR5cGU6IDF9fSAoMSBtZWFucyBudW1iZXIpLCBhbmQge2E6IFtbNV1dfSBtdXN0IG1hdGNoIHskYTpcbiAgICAvLyB7JHR5cGU6IDR9fS4gVGh1cywgd2hlbiB3ZSBzZWUgYSBsZWFmIGFycmF5LCB3ZSAqc2hvdWxkKiBleHBhbmQgaXQgYnV0XG4gICAgLy8gc2hvdWxkICpub3QqIGluY2x1ZGUgaXQgaXRzZWxmLlxuICAgIGRvbnRJbmNsdWRlTGVhZkFycmF5czogdHJ1ZSxcbiAgICBjb21waWxlRWxlbWVudFNlbGVjdG9yKG9wZXJhbmQpIHtcbiAgICAgIGlmICh0eXBlb2Ygb3BlcmFuZCAhPT0gJ251bWJlcicpIHtcbiAgICAgICAgdGhyb3cgRXJyb3IoJyR0eXBlIG5lZWRzIGEgbnVtYmVyJyk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB2YWx1ZSA9PiAoXG4gICAgICAgIHZhbHVlICE9PSB1bmRlZmluZWQgJiYgTG9jYWxDb2xsZWN0aW9uLl9mLl90eXBlKHZhbHVlKSA9PT0gb3BlcmFuZFxuICAgICAgKTtcbiAgICB9LFxuICB9LFxuICAkYml0c0FsbFNldDoge1xuICAgIGNvbXBpbGVFbGVtZW50U2VsZWN0b3Iob3BlcmFuZCkge1xuICAgICAgY29uc3QgbWFzayA9IGdldE9wZXJhbmRCaXRtYXNrKG9wZXJhbmQsICckYml0c0FsbFNldCcpO1xuICAgICAgcmV0dXJuIHZhbHVlID0+IHtcbiAgICAgICAgY29uc3QgYml0bWFzayA9IGdldFZhbHVlQml0bWFzayh2YWx1ZSwgbWFzay5sZW5ndGgpO1xuICAgICAgICByZXR1cm4gYml0bWFzayAmJiBtYXNrLmV2ZXJ5KChieXRlLCBpKSA9PiAoYml0bWFza1tpXSAmIGJ5dGUpID09PSBieXRlKTtcbiAgICAgIH07XG4gICAgfSxcbiAgfSxcbiAgJGJpdHNBbnlTZXQ6IHtcbiAgICBjb21waWxlRWxlbWVudFNlbGVjdG9yKG9wZXJhbmQpIHtcbiAgICAgIGNvbnN0IG1hc2sgPSBnZXRPcGVyYW5kQml0bWFzayhvcGVyYW5kLCAnJGJpdHNBbnlTZXQnKTtcbiAgICAgIHJldHVybiB2YWx1ZSA9PiB7XG4gICAgICAgIGNvbnN0IGJpdG1hc2sgPSBnZXRWYWx1ZUJpdG1hc2sodmFsdWUsIG1hc2subGVuZ3RoKTtcbiAgICAgICAgcmV0dXJuIGJpdG1hc2sgJiYgbWFzay5zb21lKChieXRlLCBpKSA9PiAofmJpdG1hc2tbaV0gJiBieXRlKSAhPT0gYnl0ZSk7XG4gICAgICB9O1xuICAgIH0sXG4gIH0sXG4gICRiaXRzQWxsQ2xlYXI6IHtcbiAgICBjb21waWxlRWxlbWVudFNlbGVjdG9yKG9wZXJhbmQpIHtcbiAgICAgIGNvbnN0IG1hc2sgPSBnZXRPcGVyYW5kQml0bWFzayhvcGVyYW5kLCAnJGJpdHNBbGxDbGVhcicpO1xuICAgICAgcmV0dXJuIHZhbHVlID0+IHtcbiAgICAgICAgY29uc3QgYml0bWFzayA9IGdldFZhbHVlQml0bWFzayh2YWx1ZSwgbWFzay5sZW5ndGgpO1xuICAgICAgICByZXR1cm4gYml0bWFzayAmJiBtYXNrLmV2ZXJ5KChieXRlLCBpKSA9PiAhKGJpdG1hc2tbaV0gJiBieXRlKSk7XG4gICAgICB9O1xuICAgIH0sXG4gIH0sXG4gICRiaXRzQW55Q2xlYXI6IHtcbiAgICBjb21waWxlRWxlbWVudFNlbGVjdG9yKG9wZXJhbmQpIHtcbiAgICAgIGNvbnN0IG1hc2sgPSBnZXRPcGVyYW5kQml0bWFzayhvcGVyYW5kLCAnJGJpdHNBbnlDbGVhcicpO1xuICAgICAgcmV0dXJuIHZhbHVlID0+IHtcbiAgICAgICAgY29uc3QgYml0bWFzayA9IGdldFZhbHVlQml0bWFzayh2YWx1ZSwgbWFzay5sZW5ndGgpO1xuICAgICAgICByZXR1cm4gYml0bWFzayAmJiBtYXNrLnNvbWUoKGJ5dGUsIGkpID0+IChiaXRtYXNrW2ldICYgYnl0ZSkgIT09IGJ5dGUpO1xuICAgICAgfTtcbiAgICB9LFxuICB9LFxuICAkcmVnZXg6IHtcbiAgICBjb21waWxlRWxlbWVudFNlbGVjdG9yKG9wZXJhbmQsIHZhbHVlU2VsZWN0b3IpIHtcbiAgICAgIGlmICghKHR5cGVvZiBvcGVyYW5kID09PSAnc3RyaW5nJyB8fCBvcGVyYW5kIGluc3RhbmNlb2YgUmVnRXhwKSkge1xuICAgICAgICB0aHJvdyBFcnJvcignJHJlZ2V4IGhhcyB0byBiZSBhIHN0cmluZyBvciBSZWdFeHAnKTtcbiAgICAgIH1cblxuICAgICAgbGV0IHJlZ2V4cDtcbiAgICAgIGlmICh2YWx1ZVNlbGVjdG9yLiRvcHRpb25zICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgLy8gT3B0aW9ucyBwYXNzZWQgaW4gJG9wdGlvbnMgKGV2ZW4gdGhlIGVtcHR5IHN0cmluZykgYWx3YXlzIG92ZXJyaWRlc1xuICAgICAgICAvLyBvcHRpb25zIGluIHRoZSBSZWdFeHAgb2JqZWN0IGl0c2VsZi5cblxuICAgICAgICAvLyBCZSBjbGVhciB0aGF0IHdlIG9ubHkgc3VwcG9ydCB0aGUgSlMtc3VwcG9ydGVkIG9wdGlvbnMsIG5vdCBleHRlbmRlZFxuICAgICAgICAvLyBvbmVzIChlZywgTW9uZ28gc3VwcG9ydHMgeCBhbmQgcykuIElkZWFsbHkgd2Ugd291bGQgaW1wbGVtZW50IHggYW5kIHNcbiAgICAgICAgLy8gYnkgdHJhbnNmb3JtaW5nIHRoZSByZWdleHAsIGJ1dCBub3QgdG9kYXkuLi5cbiAgICAgICAgaWYgKC9bXmdpbV0vLnRlc3QodmFsdWVTZWxlY3Rvci4kb3B0aW9ucykpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ09ubHkgdGhlIGksIG0sIGFuZCBnIHJlZ2V4cCBvcHRpb25zIGFyZSBzdXBwb3J0ZWQnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHNvdXJjZSA9IG9wZXJhbmQgaW5zdGFuY2VvZiBSZWdFeHAgPyBvcGVyYW5kLnNvdXJjZSA6IG9wZXJhbmQ7XG4gICAgICAgIHJlZ2V4cCA9IG5ldyBSZWdFeHAoc291cmNlLCB2YWx1ZVNlbGVjdG9yLiRvcHRpb25zKTtcbiAgICAgIH0gZWxzZSBpZiAob3BlcmFuZCBpbnN0YW5jZW9mIFJlZ0V4cCkge1xuICAgICAgICByZWdleHAgPSBvcGVyYW5kO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmVnZXhwID0gbmV3IFJlZ0V4cChvcGVyYW5kKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJlZ2V4cEVsZW1lbnRNYXRjaGVyKHJlZ2V4cCk7XG4gICAgfSxcbiAgfSxcbiAgJGVsZW1NYXRjaDoge1xuICAgIGRvbnRFeHBhbmRMZWFmQXJyYXlzOiB0cnVlLFxuICAgIGNvbXBpbGVFbGVtZW50U2VsZWN0b3Iob3BlcmFuZCwgdmFsdWVTZWxlY3RvciwgbWF0Y2hlcikge1xuICAgICAgaWYgKCFMb2NhbENvbGxlY3Rpb24uX2lzUGxhaW5PYmplY3Qob3BlcmFuZCkpIHtcbiAgICAgICAgdGhyb3cgRXJyb3IoJyRlbGVtTWF0Y2ggbmVlZCBhbiBvYmplY3QnKTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgaXNEb2NNYXRjaGVyID0gIWlzT3BlcmF0b3JPYmplY3QoXG4gICAgICAgIE9iamVjdC5rZXlzKG9wZXJhbmQpXG4gICAgICAgICAgLmZpbHRlcihrZXkgPT4gIWhhc093bi5jYWxsKExPR0lDQUxfT1BFUkFUT1JTLCBrZXkpKVxuICAgICAgICAgIC5yZWR1Y2UoKGEsIGIpID0+IE9iamVjdC5hc3NpZ24oYSwge1tiXTogb3BlcmFuZFtiXX0pLCB7fSksXG4gICAgICAgIHRydWUpO1xuXG4gICAgICBsZXQgc3ViTWF0Y2hlcjtcbiAgICAgIGlmIChpc0RvY01hdGNoZXIpIHtcbiAgICAgICAgLy8gVGhpcyBpcyBOT1QgdGhlIHNhbWUgYXMgY29tcGlsZVZhbHVlU2VsZWN0b3Iob3BlcmFuZCksIGFuZCBub3QganVzdFxuICAgICAgICAvLyBiZWNhdXNlIG9mIHRoZSBzbGlnaHRseSBkaWZmZXJlbnQgY2FsbGluZyBjb252ZW50aW9uLlxuICAgICAgICAvLyB7JGVsZW1NYXRjaDoge3g6IDN9fSBtZWFucyBcImFuIGVsZW1lbnQgaGFzIGEgZmllbGQgeDozXCIsIG5vdFxuICAgICAgICAvLyBcImNvbnNpc3RzIG9ubHkgb2YgYSBmaWVsZCB4OjNcIi4gQWxzbywgcmVnZXhwcyBhbmQgc3ViLSQgYXJlIGFsbG93ZWQuXG4gICAgICAgIHN1Yk1hdGNoZXIgPVxuICAgICAgICAgIGNvbXBpbGVEb2N1bWVudFNlbGVjdG9yKG9wZXJhbmQsIG1hdGNoZXIsIHtpbkVsZW1NYXRjaDogdHJ1ZX0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc3ViTWF0Y2hlciA9IGNvbXBpbGVWYWx1ZVNlbGVjdG9yKG9wZXJhbmQsIG1hdGNoZXIpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gdmFsdWUgPT4ge1xuICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB2YWx1ZS5sZW5ndGg7ICsraSkge1xuICAgICAgICAgIGNvbnN0IGFycmF5RWxlbWVudCA9IHZhbHVlW2ldO1xuICAgICAgICAgIGxldCBhcmc7XG4gICAgICAgICAgaWYgKGlzRG9jTWF0Y2hlcikge1xuICAgICAgICAgICAgLy8gV2UgY2FuIG9ubHkgbWF0Y2ggeyRlbGVtTWF0Y2g6IHtiOiAzfX0gYWdhaW5zdCBvYmplY3RzLlxuICAgICAgICAgICAgLy8gKFdlIGNhbiBhbHNvIG1hdGNoIGFnYWluc3QgYXJyYXlzLCBpZiB0aGVyZSdzIG51bWVyaWMgaW5kaWNlcyxcbiAgICAgICAgICAgIC8vIGVnIHskZWxlbU1hdGNoOiB7JzAuYic6IDN9fSBvciB7JGVsZW1NYXRjaDogezA6IDN9fS4pXG4gICAgICAgICAgICBpZiAoIWlzSW5kZXhhYmxlKGFycmF5RWxlbWVudCkpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBhcmcgPSBhcnJheUVsZW1lbnQ7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIGRvbnRJdGVyYXRlIGVuc3VyZXMgdGhhdCB7YTogeyRlbGVtTWF0Y2g6IHskZ3Q6IDV9fX0gbWF0Y2hlc1xuICAgICAgICAgICAgLy8ge2E6IFs4XX0gYnV0IG5vdCB7YTogW1s4XV19XG4gICAgICAgICAgICBhcmcgPSBbe3ZhbHVlOiBhcnJheUVsZW1lbnQsIGRvbnRJdGVyYXRlOiB0cnVlfV07XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIFhYWCBzdXBwb3J0ICRuZWFyIGluICRlbGVtTWF0Y2ggYnkgcHJvcGFnYXRpbmcgJGRpc3RhbmNlP1xuICAgICAgICAgIGlmIChzdWJNYXRjaGVyKGFyZykucmVzdWx0KSB7XG4gICAgICAgICAgICByZXR1cm4gaTsgLy8gc3BlY2lhbGx5IHVuZGVyc3Rvb2QgdG8gbWVhbiBcInVzZSBhcyBhcnJheUluZGljZXNcIlxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH07XG4gICAgfSxcbiAgfSxcbn07XG5cbi8vIE9wZXJhdG9ycyB0aGF0IGFwcGVhciBhdCB0aGUgdG9wIGxldmVsIG9mIGEgZG9jdW1lbnQgc2VsZWN0b3IuXG5jb25zdCBMT0dJQ0FMX09QRVJBVE9SUyA9IHtcbiAgJGFuZChzdWJTZWxlY3RvciwgbWF0Y2hlciwgaW5FbGVtTWF0Y2gpIHtcbiAgICByZXR1cm4gYW5kRG9jdW1lbnRNYXRjaGVycyhcbiAgICAgIGNvbXBpbGVBcnJheU9mRG9jdW1lbnRTZWxlY3RvcnMoc3ViU2VsZWN0b3IsIG1hdGNoZXIsIGluRWxlbU1hdGNoKVxuICAgICk7XG4gIH0sXG5cbiAgJG9yKHN1YlNlbGVjdG9yLCBtYXRjaGVyLCBpbkVsZW1NYXRjaCkge1xuICAgIGNvbnN0IG1hdGNoZXJzID0gY29tcGlsZUFycmF5T2ZEb2N1bWVudFNlbGVjdG9ycyhcbiAgICAgIHN1YlNlbGVjdG9yLFxuICAgICAgbWF0Y2hlcixcbiAgICAgIGluRWxlbU1hdGNoXG4gICAgKTtcblxuICAgIC8vIFNwZWNpYWwgY2FzZTogaWYgdGhlcmUgaXMgb25seSBvbmUgbWF0Y2hlciwgdXNlIGl0IGRpcmVjdGx5LCAqcHJlc2VydmluZypcbiAgICAvLyBhbnkgYXJyYXlJbmRpY2VzIGl0IHJldHVybnMuXG4gICAgaWYgKG1hdGNoZXJzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgcmV0dXJuIG1hdGNoZXJzWzBdO1xuICAgIH1cblxuICAgIHJldHVybiBkb2MgPT4ge1xuICAgICAgY29uc3QgcmVzdWx0ID0gbWF0Y2hlcnMuc29tZShmbiA9PiBmbihkb2MpLnJlc3VsdCk7XG4gICAgICAvLyAkb3IgZG9lcyBOT1Qgc2V0IGFycmF5SW5kaWNlcyB3aGVuIGl0IGhhcyBtdWx0aXBsZVxuICAgICAgLy8gc3ViLWV4cHJlc3Npb25zLiAoVGVzdGVkIGFnYWluc3QgTW9uZ29EQi4pXG4gICAgICByZXR1cm4ge3Jlc3VsdH07XG4gICAgfTtcbiAgfSxcblxuICAkbm9yKHN1YlNlbGVjdG9yLCBtYXRjaGVyLCBpbkVsZW1NYXRjaCkge1xuICAgIGNvbnN0IG1hdGNoZXJzID0gY29tcGlsZUFycmF5T2ZEb2N1bWVudFNlbGVjdG9ycyhcbiAgICAgIHN1YlNlbGVjdG9yLFxuICAgICAgbWF0Y2hlcixcbiAgICAgIGluRWxlbU1hdGNoXG4gICAgKTtcbiAgICByZXR1cm4gZG9jID0+IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IG1hdGNoZXJzLmV2ZXJ5KGZuID0+ICFmbihkb2MpLnJlc3VsdCk7XG4gICAgICAvLyBOZXZlciBzZXQgYXJyYXlJbmRpY2VzLCBiZWNhdXNlIHdlIG9ubHkgbWF0Y2ggaWYgbm90aGluZyBpbiBwYXJ0aWN1bGFyXG4gICAgICAvLyAnbWF0Y2hlZCcgKGFuZCBiZWNhdXNlIHRoaXMgaXMgY29uc2lzdGVudCB3aXRoIE1vbmdvREIpLlxuICAgICAgcmV0dXJuIHtyZXN1bHR9O1xuICAgIH07XG4gIH0sXG5cbiAgJHdoZXJlKHNlbGVjdG9yVmFsdWUsIG1hdGNoZXIpIHtcbiAgICAvLyBSZWNvcmQgdGhhdCAqYW55KiBwYXRoIG1heSBiZSB1c2VkLlxuICAgIG1hdGNoZXIuX3JlY29yZFBhdGhVc2VkKCcnKTtcbiAgICBtYXRjaGVyLl9oYXNXaGVyZSA9IHRydWU7XG5cbiAgICBpZiAoIShzZWxlY3RvclZhbHVlIGluc3RhbmNlb2YgRnVuY3Rpb24pKSB7XG4gICAgICAvLyBYWFggTW9uZ29EQiBzZWVtcyB0byBoYXZlIG1vcmUgY29tcGxleCBsb2dpYyB0byBkZWNpZGUgd2hlcmUgb3Igb3Igbm90XG4gICAgICAvLyB0byBhZGQgJ3JldHVybic7IG5vdCBzdXJlIGV4YWN0bHkgd2hhdCBpdCBpcy5cbiAgICAgIHNlbGVjdG9yVmFsdWUgPSBGdW5jdGlvbignb2JqJywgYHJldHVybiAke3NlbGVjdG9yVmFsdWV9YCk7XG4gICAgfVxuXG4gICAgLy8gV2UgbWFrZSB0aGUgZG9jdW1lbnQgYXZhaWxhYmxlIGFzIGJvdGggYHRoaXNgIGFuZCBgb2JqYC5cbiAgICAvLyAvLyBYWFggbm90IHN1cmUgd2hhdCB3ZSBzaG91bGQgZG8gaWYgdGhpcyB0aHJvd3NcbiAgICByZXR1cm4gZG9jID0+ICh7cmVzdWx0OiBzZWxlY3RvclZhbHVlLmNhbGwoZG9jLCBkb2MpfSk7XG4gIH0sXG5cbiAgLy8gVGhpcyBpcyBqdXN0IHVzZWQgYXMgYSBjb21tZW50IGluIHRoZSBxdWVyeSAoaW4gTW9uZ29EQiwgaXQgYWxzbyBlbmRzIHVwIGluXG4gIC8vIHF1ZXJ5IGxvZ3MpOyBpdCBoYXMgbm8gZWZmZWN0IG9uIHRoZSBhY3R1YWwgc2VsZWN0aW9uLlxuICAkY29tbWVudCgpIHtcbiAgICByZXR1cm4gKCkgPT4gKHtyZXN1bHQ6IHRydWV9KTtcbiAgfSxcbn07XG5cbi8vIE9wZXJhdG9ycyB0aGF0ICh1bmxpa2UgTE9HSUNBTF9PUEVSQVRPUlMpIHBlcnRhaW4gdG8gaW5kaXZpZHVhbCBwYXRocyBpbiBhXG4vLyBkb2N1bWVudCwgYnV0ICh1bmxpa2UgRUxFTUVOVF9PUEVSQVRPUlMpIGRvIG5vdCBoYXZlIGEgc2ltcGxlIGRlZmluaXRpb24gYXNcbi8vIFwibWF0Y2ggZWFjaCBicmFuY2hlZCB2YWx1ZSBpbmRlcGVuZGVudGx5IGFuZCBjb21iaW5lIHdpdGhcbi8vIGNvbnZlcnRFbGVtZW50TWF0Y2hlclRvQnJhbmNoZWRNYXRjaGVyXCIuXG5jb25zdCBWQUxVRV9PUEVSQVRPUlMgPSB7XG4gICRlcShvcGVyYW5kKSB7XG4gICAgcmV0dXJuIGNvbnZlcnRFbGVtZW50TWF0Y2hlclRvQnJhbmNoZWRNYXRjaGVyKFxuICAgICAgZXF1YWxpdHlFbGVtZW50TWF0Y2hlcihvcGVyYW5kKVxuICAgICk7XG4gIH0sXG4gICRub3Qob3BlcmFuZCwgdmFsdWVTZWxlY3RvciwgbWF0Y2hlcikge1xuICAgIHJldHVybiBpbnZlcnRCcmFuY2hlZE1hdGNoZXIoY29tcGlsZVZhbHVlU2VsZWN0b3Iob3BlcmFuZCwgbWF0Y2hlcikpO1xuICB9LFxuICAkbmUob3BlcmFuZCkge1xuICAgIHJldHVybiBpbnZlcnRCcmFuY2hlZE1hdGNoZXIoXG4gICAgICBjb252ZXJ0RWxlbWVudE1hdGNoZXJUb0JyYW5jaGVkTWF0Y2hlcihlcXVhbGl0eUVsZW1lbnRNYXRjaGVyKG9wZXJhbmQpKVxuICAgICk7XG4gIH0sXG4gICRuaW4ob3BlcmFuZCkge1xuICAgIHJldHVybiBpbnZlcnRCcmFuY2hlZE1hdGNoZXIoXG4gICAgICBjb252ZXJ0RWxlbWVudE1hdGNoZXJUb0JyYW5jaGVkTWF0Y2hlcihcbiAgICAgICAgRUxFTUVOVF9PUEVSQVRPUlMuJGluLmNvbXBpbGVFbGVtZW50U2VsZWN0b3Iob3BlcmFuZClcbiAgICAgIClcbiAgICApO1xuICB9LFxuICAkZXhpc3RzKG9wZXJhbmQpIHtcbiAgICBjb25zdCBleGlzdHMgPSBjb252ZXJ0RWxlbWVudE1hdGNoZXJUb0JyYW5jaGVkTWF0Y2hlcihcbiAgICAgIHZhbHVlID0+IHZhbHVlICE9PSB1bmRlZmluZWRcbiAgICApO1xuICAgIHJldHVybiBvcGVyYW5kID8gZXhpc3RzIDogaW52ZXJ0QnJhbmNoZWRNYXRjaGVyKGV4aXN0cyk7XG4gIH0sXG4gIC8vICRvcHRpb25zIGp1c3QgcHJvdmlkZXMgb3B0aW9ucyBmb3IgJHJlZ2V4OyBpdHMgbG9naWMgaXMgaW5zaWRlICRyZWdleFxuICAkb3B0aW9ucyhvcGVyYW5kLCB2YWx1ZVNlbGVjdG9yKSB7XG4gICAgaWYgKCFoYXNPd24uY2FsbCh2YWx1ZVNlbGVjdG9yLCAnJHJlZ2V4JykpIHtcbiAgICAgIHRocm93IEVycm9yKCckb3B0aW9ucyBuZWVkcyBhICRyZWdleCcpO1xuICAgIH1cblxuICAgIHJldHVybiBldmVyeXRoaW5nTWF0Y2hlcjtcbiAgfSxcbiAgLy8gJG1heERpc3RhbmNlIGlzIGJhc2ljYWxseSBhbiBhcmd1bWVudCB0byAkbmVhclxuICAkbWF4RGlzdGFuY2Uob3BlcmFuZCwgdmFsdWVTZWxlY3Rvcikge1xuICAgIGlmICghdmFsdWVTZWxlY3Rvci4kbmVhcikge1xuICAgICAgdGhyb3cgRXJyb3IoJyRtYXhEaXN0YW5jZSBuZWVkcyBhICRuZWFyJyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGV2ZXJ5dGhpbmdNYXRjaGVyO1xuICB9LFxuICAkYWxsKG9wZXJhbmQsIHZhbHVlU2VsZWN0b3IsIG1hdGNoZXIpIHtcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkob3BlcmFuZCkpIHtcbiAgICAgIHRocm93IEVycm9yKCckYWxsIHJlcXVpcmVzIGFycmF5Jyk7XG4gICAgfVxuXG4gICAgLy8gTm90IHN1cmUgd2h5LCBidXQgdGhpcyBzZWVtcyB0byBiZSB3aGF0IE1vbmdvREIgZG9lcy5cbiAgICBpZiAob3BlcmFuZC5sZW5ndGggPT09IDApIHtcbiAgICAgIHJldHVybiBub3RoaW5nTWF0Y2hlcjtcbiAgICB9XG5cbiAgICBjb25zdCBicmFuY2hlZE1hdGNoZXJzID0gb3BlcmFuZC5tYXAoY3JpdGVyaW9uID0+IHtcbiAgICAgIC8vIFhYWCBoYW5kbGUgJGFsbC8kZWxlbU1hdGNoIGNvbWJpbmF0aW9uXG4gICAgICBpZiAoaXNPcGVyYXRvck9iamVjdChjcml0ZXJpb24pKSB7XG4gICAgICAgIHRocm93IEVycm9yKCdubyAkIGV4cHJlc3Npb25zIGluICRhbGwnKTtcbiAgICAgIH1cblxuICAgICAgLy8gVGhpcyBpcyBhbHdheXMgYSByZWdleHAgb3IgZXF1YWxpdHkgc2VsZWN0b3IuXG4gICAgICByZXR1cm4gY29tcGlsZVZhbHVlU2VsZWN0b3IoY3JpdGVyaW9uLCBtYXRjaGVyKTtcbiAgICB9KTtcblxuICAgIC8vIGFuZEJyYW5jaGVkTWF0Y2hlcnMgZG9lcyBOT1QgcmVxdWlyZSBhbGwgc2VsZWN0b3JzIHRvIHJldHVybiB0cnVlIG9uIHRoZVxuICAgIC8vIFNBTUUgYnJhbmNoLlxuICAgIHJldHVybiBhbmRCcmFuY2hlZE1hdGNoZXJzKGJyYW5jaGVkTWF0Y2hlcnMpO1xuICB9LFxuICAkbmVhcihvcGVyYW5kLCB2YWx1ZVNlbGVjdG9yLCBtYXRjaGVyLCBpc1Jvb3QpIHtcbiAgICBpZiAoIWlzUm9vdCkge1xuICAgICAgdGhyb3cgRXJyb3IoJyRuZWFyIGNhblxcJ3QgYmUgaW5zaWRlIGFub3RoZXIgJCBvcGVyYXRvcicpO1xuICAgIH1cblxuICAgIG1hdGNoZXIuX2hhc0dlb1F1ZXJ5ID0gdHJ1ZTtcblxuICAgIC8vIFRoZXJlIGFyZSB0d28ga2luZHMgb2YgZ2VvZGF0YSBpbiBNb25nb0RCOiBsZWdhY3kgY29vcmRpbmF0ZSBwYWlycyBhbmRcbiAgICAvLyBHZW9KU09OLiBUaGV5IHVzZSBkaWZmZXJlbnQgZGlzdGFuY2UgbWV0cmljcywgdG9vLiBHZW9KU09OIHF1ZXJpZXMgYXJlXG4gICAgLy8gbWFya2VkIHdpdGggYSAkZ2VvbWV0cnkgcHJvcGVydHksIHRob3VnaCBsZWdhY3kgY29vcmRpbmF0ZXMgY2FuIGJlXG4gICAgLy8gbWF0Y2hlZCB1c2luZyAkZ2VvbWV0cnkuXG4gICAgbGV0IG1heERpc3RhbmNlLCBwb2ludCwgZGlzdGFuY2U7XG4gICAgaWYgKExvY2FsQ29sbGVjdGlvbi5faXNQbGFpbk9iamVjdChvcGVyYW5kKSAmJiBoYXNPd24uY2FsbChvcGVyYW5kLCAnJGdlb21ldHJ5JykpIHtcbiAgICAgIC8vIEdlb0pTT04gXCIyZHNwaGVyZVwiIG1vZGUuXG4gICAgICBtYXhEaXN0YW5jZSA9IG9wZXJhbmQuJG1heERpc3RhbmNlO1xuICAgICAgcG9pbnQgPSBvcGVyYW5kLiRnZW9tZXRyeTtcbiAgICAgIGRpc3RhbmNlID0gdmFsdWUgPT4ge1xuICAgICAgICAvLyBYWFg6IGZvciBub3csIHdlIGRvbid0IGNhbGN1bGF0ZSB0aGUgYWN0dWFsIGRpc3RhbmNlIGJldHdlZW4sIHNheSxcbiAgICAgICAgLy8gcG9seWdvbiBhbmQgY2lyY2xlLiBJZiBwZW9wbGUgY2FyZSBhYm91dCB0aGlzIHVzZS1jYXNlIGl0IHdpbGwgZ2V0XG4gICAgICAgIC8vIGEgcHJpb3JpdHkuXG4gICAgICAgIGlmICghdmFsdWUpIHtcbiAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghdmFsdWUudHlwZSkge1xuICAgICAgICAgIHJldHVybiBHZW9KU09OLnBvaW50RGlzdGFuY2UoXG4gICAgICAgICAgICBwb2ludCxcbiAgICAgICAgICAgIHt0eXBlOiAnUG9pbnQnLCBjb29yZGluYXRlczogcG9pbnRUb0FycmF5KHZhbHVlKX1cbiAgICAgICAgICApO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHZhbHVlLnR5cGUgPT09ICdQb2ludCcpIHtcbiAgICAgICAgICByZXR1cm4gR2VvSlNPTi5wb2ludERpc3RhbmNlKHBvaW50LCB2YWx1ZSk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gR2VvSlNPTi5nZW9tZXRyeVdpdGhpblJhZGl1cyh2YWx1ZSwgcG9pbnQsIG1heERpc3RhbmNlKVxuICAgICAgICAgID8gMFxuICAgICAgICAgIDogbWF4RGlzdGFuY2UgKyAxO1xuICAgICAgfTtcbiAgICB9IGVsc2Uge1xuICAgICAgbWF4RGlzdGFuY2UgPSB2YWx1ZVNlbGVjdG9yLiRtYXhEaXN0YW5jZTtcblxuICAgICAgaWYgKCFpc0luZGV4YWJsZShvcGVyYW5kKSkge1xuICAgICAgICB0aHJvdyBFcnJvcignJG5lYXIgYXJndW1lbnQgbXVzdCBiZSBjb29yZGluYXRlIHBhaXIgb3IgR2VvSlNPTicpO1xuICAgICAgfVxuXG4gICAgICBwb2ludCA9IHBvaW50VG9BcnJheShvcGVyYW5kKTtcblxuICAgICAgZGlzdGFuY2UgPSB2YWx1ZSA9PiB7XG4gICAgICAgIGlmICghaXNJbmRleGFibGUodmFsdWUpKSB7XG4gICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gZGlzdGFuY2VDb29yZGluYXRlUGFpcnMocG9pbnQsIHZhbHVlKTtcbiAgICAgIH07XG4gICAgfVxuXG4gICAgcmV0dXJuIGJyYW5jaGVkVmFsdWVzID0+IHtcbiAgICAgIC8vIFRoZXJlIG1pZ2h0IGJlIG11bHRpcGxlIHBvaW50cyBpbiB0aGUgZG9jdW1lbnQgdGhhdCBtYXRjaCB0aGUgZ2l2ZW5cbiAgICAgIC8vIGZpZWxkLiBPbmx5IG9uZSBvZiB0aGVtIG5lZWRzIHRvIGJlIHdpdGhpbiAkbWF4RGlzdGFuY2UsIGJ1dCB3ZSBuZWVkIHRvXG4gICAgICAvLyBldmFsdWF0ZSBhbGwgb2YgdGhlbSBhbmQgdXNlIHRoZSBuZWFyZXN0IG9uZSBmb3IgdGhlIGltcGxpY2l0IHNvcnRcbiAgICAgIC8vIHNwZWNpZmllci4gKFRoYXQncyB3aHkgd2UgY2FuJ3QganVzdCB1c2UgRUxFTUVOVF9PUEVSQVRPUlMgaGVyZS4pXG4gICAgICAvL1xuICAgICAgLy8gTm90ZTogVGhpcyBkaWZmZXJzIGZyb20gTW9uZ29EQidzIGltcGxlbWVudGF0aW9uLCB3aGVyZSBhIGRvY3VtZW50IHdpbGxcbiAgICAgIC8vIGFjdHVhbGx5IHNob3cgdXAgKm11bHRpcGxlIHRpbWVzKiBpbiB0aGUgcmVzdWx0IHNldCwgd2l0aCBvbmUgZW50cnkgZm9yXG4gICAgICAvLyBlYWNoIHdpdGhpbi0kbWF4RGlzdGFuY2UgYnJhbmNoaW5nIHBvaW50LlxuICAgICAgY29uc3QgcmVzdWx0ID0ge3Jlc3VsdDogZmFsc2V9O1xuICAgICAgZXhwYW5kQXJyYXlzSW5CcmFuY2hlcyhicmFuY2hlZFZhbHVlcykuZXZlcnkoYnJhbmNoID0+IHtcbiAgICAgICAgLy8gaWYgb3BlcmF0aW9uIGlzIGFuIHVwZGF0ZSwgZG9uJ3Qgc2tpcCBicmFuY2hlcywganVzdCByZXR1cm4gdGhlIGZpcnN0XG4gICAgICAgIC8vIG9uZSAoIzM1OTkpXG4gICAgICAgIGxldCBjdXJEaXN0YW5jZTtcbiAgICAgICAgaWYgKCFtYXRjaGVyLl9pc1VwZGF0ZSkge1xuICAgICAgICAgIGlmICghKHR5cGVvZiBicmFuY2gudmFsdWUgPT09ICdvYmplY3QnKSkge1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY3VyRGlzdGFuY2UgPSBkaXN0YW5jZShicmFuY2gudmFsdWUpO1xuXG4gICAgICAgICAgLy8gU2tpcCBicmFuY2hlcyB0aGF0IGFyZW4ndCByZWFsIHBvaW50cyBvciBhcmUgdG9vIGZhciBhd2F5LlxuICAgICAgICAgIGlmIChjdXJEaXN0YW5jZSA9PT0gbnVsbCB8fCBjdXJEaXN0YW5jZSA+IG1heERpc3RhbmNlKSB7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyBTa2lwIGFueXRoaW5nIHRoYXQncyBhIHRpZS5cbiAgICAgICAgICBpZiAocmVzdWx0LmRpc3RhbmNlICE9PSB1bmRlZmluZWQgJiYgcmVzdWx0LmRpc3RhbmNlIDw9IGN1ckRpc3RhbmNlKSB7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXN1bHQucmVzdWx0ID0gdHJ1ZTtcbiAgICAgICAgcmVzdWx0LmRpc3RhbmNlID0gY3VyRGlzdGFuY2U7XG5cbiAgICAgICAgaWYgKGJyYW5jaC5hcnJheUluZGljZXMpIHtcbiAgICAgICAgICByZXN1bHQuYXJyYXlJbmRpY2VzID0gYnJhbmNoLmFycmF5SW5kaWNlcztcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBkZWxldGUgcmVzdWx0LmFycmF5SW5kaWNlcztcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiAhbWF0Y2hlci5faXNVcGRhdGU7XG4gICAgICB9KTtcblxuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9O1xuICB9LFxufTtcblxuLy8gTkI6IFdlIGFyZSBjaGVhdGluZyBhbmQgdXNpbmcgdGhpcyBmdW5jdGlvbiB0byBpbXBsZW1lbnQgJ0FORCcgZm9yIGJvdGhcbi8vICdkb2N1bWVudCBtYXRjaGVycycgYW5kICdicmFuY2hlZCBtYXRjaGVycycuIFRoZXkgYm90aCByZXR1cm4gcmVzdWx0IG9iamVjdHNcbi8vIGJ1dCB0aGUgYXJndW1lbnQgaXMgZGlmZmVyZW50OiBmb3IgdGhlIGZvcm1lciBpdCdzIGEgd2hvbGUgZG9jLCB3aGVyZWFzIGZvclxuLy8gdGhlIGxhdHRlciBpdCdzIGFuIGFycmF5IG9mICdicmFuY2hlZCB2YWx1ZXMnLlxuZnVuY3Rpb24gYW5kU29tZU1hdGNoZXJzKHN1Yk1hdGNoZXJzKSB7XG4gIGlmIChzdWJNYXRjaGVycy5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gZXZlcnl0aGluZ01hdGNoZXI7XG4gIH1cblxuICBpZiAoc3ViTWF0Y2hlcnMubGVuZ3RoID09PSAxKSB7XG4gICAgcmV0dXJuIHN1Yk1hdGNoZXJzWzBdO1xuICB9XG5cbiAgcmV0dXJuIGRvY09yQnJhbmNoZXMgPT4ge1xuICAgIGNvbnN0IG1hdGNoID0ge307XG4gICAgbWF0Y2gucmVzdWx0ID0gc3ViTWF0Y2hlcnMuZXZlcnkoZm4gPT4ge1xuICAgICAgY29uc3Qgc3ViUmVzdWx0ID0gZm4oZG9jT3JCcmFuY2hlcyk7XG5cbiAgICAgIC8vIENvcHkgYSAnZGlzdGFuY2UnIG51bWJlciBvdXQgb2YgdGhlIGZpcnN0IHN1Yi1tYXRjaGVyIHRoYXQgaGFzXG4gICAgICAvLyBvbmUuIFllcywgdGhpcyBtZWFucyB0aGF0IGlmIHRoZXJlIGFyZSBtdWx0aXBsZSAkbmVhciBmaWVsZHMgaW4gYVxuICAgICAgLy8gcXVlcnksIHNvbWV0aGluZyBhcmJpdHJhcnkgaGFwcGVuczsgdGhpcyBhcHBlYXJzIHRvIGJlIGNvbnNpc3RlbnQgd2l0aFxuICAgICAgLy8gTW9uZ28uXG4gICAgICBpZiAoc3ViUmVzdWx0LnJlc3VsdCAmJlxuICAgICAgICAgIHN1YlJlc3VsdC5kaXN0YW5jZSAhPT0gdW5kZWZpbmVkICYmXG4gICAgICAgICAgbWF0Y2guZGlzdGFuY2UgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICBtYXRjaC5kaXN0YW5jZSA9IHN1YlJlc3VsdC5kaXN0YW5jZTtcbiAgICAgIH1cblxuICAgICAgLy8gU2ltaWxhcmx5LCBwcm9wYWdhdGUgYXJyYXlJbmRpY2VzIGZyb20gc3ViLW1hdGNoZXJzLi4uIGJ1dCB0byBtYXRjaFxuICAgICAgLy8gTW9uZ29EQiBiZWhhdmlvciwgdGhpcyB0aW1lIHRoZSAqbGFzdCogc3ViLW1hdGNoZXIgd2l0aCBhcnJheUluZGljZXNcbiAgICAgIC8vIHdpbnMuXG4gICAgICBpZiAoc3ViUmVzdWx0LnJlc3VsdCAmJiBzdWJSZXN1bHQuYXJyYXlJbmRpY2VzKSB7XG4gICAgICAgIG1hdGNoLmFycmF5SW5kaWNlcyA9IHN1YlJlc3VsdC5hcnJheUluZGljZXM7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBzdWJSZXN1bHQucmVzdWx0O1xuICAgIH0pO1xuXG4gICAgLy8gSWYgd2UgZGlkbid0IGFjdHVhbGx5IG1hdGNoLCBmb3JnZXQgYW55IGV4dHJhIG1ldGFkYXRhIHdlIGNhbWUgdXAgd2l0aC5cbiAgICBpZiAoIW1hdGNoLnJlc3VsdCkge1xuICAgICAgZGVsZXRlIG1hdGNoLmRpc3RhbmNlO1xuICAgICAgZGVsZXRlIG1hdGNoLmFycmF5SW5kaWNlcztcbiAgICB9XG5cbiAgICByZXR1cm4gbWF0Y2g7XG4gIH07XG59XG5cbmNvbnN0IGFuZERvY3VtZW50TWF0Y2hlcnMgPSBhbmRTb21lTWF0Y2hlcnM7XG5jb25zdCBhbmRCcmFuY2hlZE1hdGNoZXJzID0gYW5kU29tZU1hdGNoZXJzO1xuXG5mdW5jdGlvbiBjb21waWxlQXJyYXlPZkRvY3VtZW50U2VsZWN0b3JzKHNlbGVjdG9ycywgbWF0Y2hlciwgaW5FbGVtTWF0Y2gpIHtcbiAgaWYgKCFBcnJheS5pc0FycmF5KHNlbGVjdG9ycykgfHwgc2VsZWN0b3JzLmxlbmd0aCA9PT0gMCkge1xuICAgIHRocm93IEVycm9yKCckYW5kLyRvci8kbm9yIG11c3QgYmUgbm9uZW1wdHkgYXJyYXknKTtcbiAgfVxuXG4gIHJldHVybiBzZWxlY3RvcnMubWFwKHN1YlNlbGVjdG9yID0+IHtcbiAgICBpZiAoIUxvY2FsQ29sbGVjdGlvbi5faXNQbGFpbk9iamVjdChzdWJTZWxlY3RvcikpIHtcbiAgICAgIHRocm93IEVycm9yKCckb3IvJGFuZC8kbm9yIGVudHJpZXMgbmVlZCB0byBiZSBmdWxsIG9iamVjdHMnKTtcbiAgICB9XG5cbiAgICByZXR1cm4gY29tcGlsZURvY3VtZW50U2VsZWN0b3Ioc3ViU2VsZWN0b3IsIG1hdGNoZXIsIHtpbkVsZW1NYXRjaH0pO1xuICB9KTtcbn1cblxuLy8gVGFrZXMgaW4gYSBzZWxlY3RvciB0aGF0IGNvdWxkIG1hdGNoIGEgZnVsbCBkb2N1bWVudCAoZWcsIHRoZSBvcmlnaW5hbFxuLy8gc2VsZWN0b3IpLiBSZXR1cm5zIGEgZnVuY3Rpb24gbWFwcGluZyBkb2N1bWVudC0+cmVzdWx0IG9iamVjdC5cbi8vXG4vLyBtYXRjaGVyIGlzIHRoZSBNYXRjaGVyIG9iamVjdCB3ZSBhcmUgY29tcGlsaW5nLlxuLy9cbi8vIElmIHRoaXMgaXMgdGhlIHJvb3QgZG9jdW1lbnQgc2VsZWN0b3IgKGllLCBub3Qgd3JhcHBlZCBpbiAkYW5kIG9yIHRoZSBsaWtlKSxcbi8vIHRoZW4gaXNSb290IGlzIHRydWUuIChUaGlzIGlzIHVzZWQgYnkgJG5lYXIuKVxuZXhwb3J0IGZ1bmN0aW9uIGNvbXBpbGVEb2N1bWVudFNlbGVjdG9yKGRvY1NlbGVjdG9yLCBtYXRjaGVyLCBvcHRpb25zID0ge30pIHtcbiAgY29uc3QgZG9jTWF0Y2hlcnMgPSBPYmplY3Qua2V5cyhkb2NTZWxlY3RvcikubWFwKGtleSA9PiB7XG4gICAgY29uc3Qgc3ViU2VsZWN0b3IgPSBkb2NTZWxlY3RvcltrZXldO1xuXG4gICAgaWYgKGtleS5zdWJzdHIoMCwgMSkgPT09ICckJykge1xuICAgICAgLy8gT3V0ZXIgb3BlcmF0b3JzIGFyZSBlaXRoZXIgbG9naWNhbCBvcGVyYXRvcnMgKHRoZXkgcmVjdXJzZSBiYWNrIGludG9cbiAgICAgIC8vIHRoaXMgZnVuY3Rpb24pLCBvciAkd2hlcmUuXG4gICAgICBpZiAoIWhhc093bi5jYWxsKExPR0lDQUxfT1BFUkFUT1JTLCBrZXkpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5yZWNvZ25pemVkIGxvZ2ljYWwgb3BlcmF0b3I6ICR7a2V5fWApO1xuICAgICAgfVxuXG4gICAgICBtYXRjaGVyLl9pc1NpbXBsZSA9IGZhbHNlO1xuICAgICAgcmV0dXJuIExPR0lDQUxfT1BFUkFUT1JTW2tleV0oc3ViU2VsZWN0b3IsIG1hdGNoZXIsIG9wdGlvbnMuaW5FbGVtTWF0Y2gpO1xuICAgIH1cblxuICAgIC8vIFJlY29yZCB0aGlzIHBhdGgsIGJ1dCBvbmx5IGlmIHdlIGFyZW4ndCBpbiBhbiBlbGVtTWF0Y2hlciwgc2luY2UgaW4gYW5cbiAgICAvLyBlbGVtTWF0Y2ggdGhpcyBpcyBhIHBhdGggaW5zaWRlIGFuIG9iamVjdCBpbiBhbiBhcnJheSwgbm90IGluIHRoZSBkb2NcbiAgICAvLyByb290LlxuICAgIGlmICghb3B0aW9ucy5pbkVsZW1NYXRjaCkge1xuICAgICAgbWF0Y2hlci5fcmVjb3JkUGF0aFVzZWQoa2V5KTtcbiAgICB9XG5cbiAgICAvLyBEb24ndCBhZGQgYSBtYXRjaGVyIGlmIHN1YlNlbGVjdG9yIGlzIGEgZnVuY3Rpb24gLS0gdGhpcyBpcyB0byBtYXRjaFxuICAgIC8vIHRoZSBiZWhhdmlvciBvZiBNZXRlb3Igb24gdGhlIHNlcnZlciAoaW5oZXJpdGVkIGZyb20gdGhlIG5vZGUgbW9uZ29kYlxuICAgIC8vIGRyaXZlciksIHdoaWNoIGlzIHRvIGlnbm9yZSBhbnkgcGFydCBvZiBhIHNlbGVjdG9yIHdoaWNoIGlzIGEgZnVuY3Rpb24uXG4gICAgaWYgKHR5cGVvZiBzdWJTZWxlY3RvciA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBjb25zdCBsb29rVXBCeUluZGV4ID0gbWFrZUxvb2t1cEZ1bmN0aW9uKGtleSk7XG4gICAgY29uc3QgdmFsdWVNYXRjaGVyID0gY29tcGlsZVZhbHVlU2VsZWN0b3IoXG4gICAgICBzdWJTZWxlY3RvcixcbiAgICAgIG1hdGNoZXIsXG4gICAgICBvcHRpb25zLmlzUm9vdFxuICAgICk7XG5cbiAgICByZXR1cm4gZG9jID0+IHZhbHVlTWF0Y2hlcihsb29rVXBCeUluZGV4KGRvYykpO1xuICB9KS5maWx0ZXIoQm9vbGVhbik7XG5cbiAgcmV0dXJuIGFuZERvY3VtZW50TWF0Y2hlcnMoZG9jTWF0Y2hlcnMpO1xufVxuXG4vLyBUYWtlcyBpbiBhIHNlbGVjdG9yIHRoYXQgY291bGQgbWF0Y2ggYSBrZXktaW5kZXhlZCB2YWx1ZSBpbiBhIGRvY3VtZW50OyBlZyxcbi8vIHskZ3Q6IDUsICRsdDogOX0sIG9yIGEgcmVndWxhciBleHByZXNzaW9uLCBvciBhbnkgbm9uLWV4cHJlc3Npb24gb2JqZWN0ICh0b1xuLy8gaW5kaWNhdGUgZXF1YWxpdHkpLiAgUmV0dXJucyBhIGJyYW5jaGVkIG1hdGNoZXI6IGEgZnVuY3Rpb24gbWFwcGluZ1xuLy8gW2JyYW5jaGVkIHZhbHVlXS0+cmVzdWx0IG9iamVjdC5cbmZ1bmN0aW9uIGNvbXBpbGVWYWx1ZVNlbGVjdG9yKHZhbHVlU2VsZWN0b3IsIG1hdGNoZXIsIGlzUm9vdCkge1xuICBpZiAodmFsdWVTZWxlY3RvciBpbnN0YW5jZW9mIFJlZ0V4cCkge1xuICAgIG1hdGNoZXIuX2lzU2ltcGxlID0gZmFsc2U7XG4gICAgcmV0dXJuIGNvbnZlcnRFbGVtZW50TWF0Y2hlclRvQnJhbmNoZWRNYXRjaGVyKFxuICAgICAgcmVnZXhwRWxlbWVudE1hdGNoZXIodmFsdWVTZWxlY3RvcilcbiAgICApO1xuICB9XG5cbiAgaWYgKGlzT3BlcmF0b3JPYmplY3QodmFsdWVTZWxlY3RvcikpIHtcbiAgICByZXR1cm4gb3BlcmF0b3JCcmFuY2hlZE1hdGNoZXIodmFsdWVTZWxlY3RvciwgbWF0Y2hlciwgaXNSb290KTtcbiAgfVxuXG4gIHJldHVybiBjb252ZXJ0RWxlbWVudE1hdGNoZXJUb0JyYW5jaGVkTWF0Y2hlcihcbiAgICBlcXVhbGl0eUVsZW1lbnRNYXRjaGVyKHZhbHVlU2VsZWN0b3IpXG4gICk7XG59XG5cbi8vIEdpdmVuIGFuIGVsZW1lbnQgbWF0Y2hlciAod2hpY2ggZXZhbHVhdGVzIGEgc2luZ2xlIHZhbHVlKSwgcmV0dXJucyBhIGJyYW5jaGVkXG4vLyB2YWx1ZSAod2hpY2ggZXZhbHVhdGVzIHRoZSBlbGVtZW50IG1hdGNoZXIgb24gYWxsIHRoZSBicmFuY2hlcyBhbmQgcmV0dXJucyBhXG4vLyBtb3JlIHN0cnVjdHVyZWQgcmV0dXJuIHZhbHVlIHBvc3NpYmx5IGluY2x1ZGluZyBhcnJheUluZGljZXMpLlxuZnVuY3Rpb24gY29udmVydEVsZW1lbnRNYXRjaGVyVG9CcmFuY2hlZE1hdGNoZXIoZWxlbWVudE1hdGNoZXIsIG9wdGlvbnMgPSB7fSkge1xuICByZXR1cm4gYnJhbmNoZXMgPT4ge1xuICAgIGNvbnN0IGV4cGFuZGVkID0gb3B0aW9ucy5kb250RXhwYW5kTGVhZkFycmF5c1xuICAgICAgPyBicmFuY2hlc1xuICAgICAgOiBleHBhbmRBcnJheXNJbkJyYW5jaGVzKGJyYW5jaGVzLCBvcHRpb25zLmRvbnRJbmNsdWRlTGVhZkFycmF5cyk7XG5cbiAgICBjb25zdCBtYXRjaCA9IHt9O1xuICAgIG1hdGNoLnJlc3VsdCA9IGV4cGFuZGVkLnNvbWUoZWxlbWVudCA9PiB7XG4gICAgICBsZXQgbWF0Y2hlZCA9IGVsZW1lbnRNYXRjaGVyKGVsZW1lbnQudmFsdWUpO1xuXG4gICAgICAvLyBTcGVjaWFsIGNhc2UgZm9yICRlbGVtTWF0Y2g6IGl0IG1lYW5zIFwidHJ1ZSwgYW5kIHVzZSB0aGlzIGFzIGFuIGFycmF5XG4gICAgICAvLyBpbmRleCBpZiBJIGRpZG4ndCBhbHJlYWR5IGhhdmUgb25lXCIuXG4gICAgICBpZiAodHlwZW9mIG1hdGNoZWQgPT09ICdudW1iZXInKSB7XG4gICAgICAgIC8vIFhYWCBUaGlzIGNvZGUgZGF0ZXMgZnJvbSB3aGVuIHdlIG9ubHkgc3RvcmVkIGEgc2luZ2xlIGFycmF5IGluZGV4XG4gICAgICAgIC8vIChmb3IgdGhlIG91dGVybW9zdCBhcnJheSkuIFNob3VsZCB3ZSBiZSBhbHNvIGluY2x1ZGluZyBkZWVwZXIgYXJyYXlcbiAgICAgICAgLy8gaW5kaWNlcyBmcm9tIHRoZSAkZWxlbU1hdGNoIG1hdGNoP1xuICAgICAgICBpZiAoIWVsZW1lbnQuYXJyYXlJbmRpY2VzKSB7XG4gICAgICAgICAgZWxlbWVudC5hcnJheUluZGljZXMgPSBbbWF0Y2hlZF07XG4gICAgICAgIH1cblxuICAgICAgICBtYXRjaGVkID0gdHJ1ZTtcbiAgICAgIH1cblxuICAgICAgLy8gSWYgc29tZSBlbGVtZW50IG1hdGNoZWQsIGFuZCBpdCdzIHRhZ2dlZCB3aXRoIGFycmF5IGluZGljZXMsIGluY2x1ZGVcbiAgICAgIC8vIHRob3NlIGluZGljZXMgaW4gb3VyIHJlc3VsdCBvYmplY3QuXG4gICAgICBpZiAobWF0Y2hlZCAmJiBlbGVtZW50LmFycmF5SW5kaWNlcykge1xuICAgICAgICBtYXRjaC5hcnJheUluZGljZXMgPSBlbGVtZW50LmFycmF5SW5kaWNlcztcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIG1hdGNoZWQ7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gbWF0Y2g7XG4gIH07XG59XG5cbi8vIEhlbHBlcnMgZm9yICRuZWFyLlxuZnVuY3Rpb24gZGlzdGFuY2VDb29yZGluYXRlUGFpcnMoYSwgYikge1xuICBjb25zdCBwb2ludEEgPSBwb2ludFRvQXJyYXkoYSk7XG4gIGNvbnN0IHBvaW50QiA9IHBvaW50VG9BcnJheShiKTtcblxuICByZXR1cm4gTWF0aC5oeXBvdChwb2ludEFbMF0gLSBwb2ludEJbMF0sIHBvaW50QVsxXSAtIHBvaW50QlsxXSk7XG59XG5cbi8vIFRha2VzIHNvbWV0aGluZyB0aGF0IGlzIG5vdCBhbiBvcGVyYXRvciBvYmplY3QgYW5kIHJldHVybnMgYW4gZWxlbWVudCBtYXRjaGVyXG4vLyBmb3IgZXF1YWxpdHkgd2l0aCB0aGF0IHRoaW5nLlxuZXhwb3J0IGZ1bmN0aW9uIGVxdWFsaXR5RWxlbWVudE1hdGNoZXIoZWxlbWVudFNlbGVjdG9yKSB7XG4gIGlmIChpc09wZXJhdG9yT2JqZWN0KGVsZW1lbnRTZWxlY3RvcikpIHtcbiAgICB0aHJvdyBFcnJvcignQ2FuXFwndCBjcmVhdGUgZXF1YWxpdHlWYWx1ZVNlbGVjdG9yIGZvciBvcGVyYXRvciBvYmplY3QnKTtcbiAgfVxuXG4gIC8vIFNwZWNpYWwtY2FzZTogbnVsbCBhbmQgdW5kZWZpbmVkIGFyZSBlcXVhbCAoaWYgeW91IGdvdCB1bmRlZmluZWQgaW4gdGhlcmVcbiAgLy8gc29tZXdoZXJlLCBvciBpZiB5b3UgZ290IGl0IGR1ZSB0byBzb21lIGJyYW5jaCBiZWluZyBub24tZXhpc3RlbnQgaW4gdGhlXG4gIC8vIHdlaXJkIHNwZWNpYWwgY2FzZSksIGV2ZW4gdGhvdWdoIHRoZXkgYXJlbid0IHdpdGggRUpTT04uZXF1YWxzLlxuICAvLyB1bmRlZmluZWQgb3IgbnVsbFxuICBpZiAoZWxlbWVudFNlbGVjdG9yID09IG51bGwpIHtcbiAgICByZXR1cm4gdmFsdWUgPT4gdmFsdWUgPT0gbnVsbDtcbiAgfVxuXG4gIHJldHVybiB2YWx1ZSA9PiBMb2NhbENvbGxlY3Rpb24uX2YuX2VxdWFsKGVsZW1lbnRTZWxlY3RvciwgdmFsdWUpO1xufVxuXG5mdW5jdGlvbiBldmVyeXRoaW5nTWF0Y2hlcihkb2NPckJyYW5jaGVkVmFsdWVzKSB7XG4gIHJldHVybiB7cmVzdWx0OiB0cnVlfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGV4cGFuZEFycmF5c0luQnJhbmNoZXMoYnJhbmNoZXMsIHNraXBUaGVBcnJheXMpIHtcbiAgY29uc3QgYnJhbmNoZXNPdXQgPSBbXTtcblxuICBicmFuY2hlcy5mb3JFYWNoKGJyYW5jaCA9PiB7XG4gICAgY29uc3QgdGhpc0lzQXJyYXkgPSBBcnJheS5pc0FycmF5KGJyYW5jaC52YWx1ZSk7XG5cbiAgICAvLyBXZSBpbmNsdWRlIHRoZSBicmFuY2ggaXRzZWxmLCAqVU5MRVNTKiB3ZSBpdCdzIGFuIGFycmF5IHRoYXQgd2UncmUgZ29pbmdcbiAgICAvLyB0byBpdGVyYXRlIGFuZCB3ZSdyZSB0b2xkIHRvIHNraXAgYXJyYXlzLiAgKFRoYXQncyByaWdodCwgd2UgaW5jbHVkZSBzb21lXG4gICAgLy8gYXJyYXlzIGV2ZW4gc2tpcFRoZUFycmF5cyBpcyB0cnVlOiB0aGVzZSBhcmUgYXJyYXlzIHRoYXQgd2VyZSBmb3VuZCB2aWFcbiAgICAvLyBleHBsaWNpdCBudW1lcmljYWwgaW5kaWNlcy4pXG4gICAgaWYgKCEoc2tpcFRoZUFycmF5cyAmJiB0aGlzSXNBcnJheSAmJiAhYnJhbmNoLmRvbnRJdGVyYXRlKSkge1xuICAgICAgYnJhbmNoZXNPdXQucHVzaCh7YXJyYXlJbmRpY2VzOiBicmFuY2guYXJyYXlJbmRpY2VzLCB2YWx1ZTogYnJhbmNoLnZhbHVlfSk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXNJc0FycmF5ICYmICFicmFuY2guZG9udEl0ZXJhdGUpIHtcbiAgICAgIGJyYW5jaC52YWx1ZS5mb3JFYWNoKCh2YWx1ZSwgaSkgPT4ge1xuICAgICAgICBicmFuY2hlc091dC5wdXNoKHtcbiAgICAgICAgICBhcnJheUluZGljZXM6IChicmFuY2guYXJyYXlJbmRpY2VzIHx8IFtdKS5jb25jYXQoaSksXG4gICAgICAgICAgdmFsdWVcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9XG4gIH0pO1xuXG4gIHJldHVybiBicmFuY2hlc091dDtcbn1cblxuLy8gSGVscGVycyBmb3IgJGJpdHNBbGxTZXQvJGJpdHNBbnlTZXQvJGJpdHNBbGxDbGVhci8kYml0c0FueUNsZWFyLlxuZnVuY3Rpb24gZ2V0T3BlcmFuZEJpdG1hc2sob3BlcmFuZCwgc2VsZWN0b3IpIHtcbiAgLy8gbnVtZXJpYyBiaXRtYXNrXG4gIC8vIFlvdSBjYW4gcHJvdmlkZSBhIG51bWVyaWMgYml0bWFzayB0byBiZSBtYXRjaGVkIGFnYWluc3QgdGhlIG9wZXJhbmQgZmllbGQuXG4gIC8vIEl0IG11c3QgYmUgcmVwcmVzZW50YWJsZSBhcyBhIG5vbi1uZWdhdGl2ZSAzMi1iaXQgc2lnbmVkIGludGVnZXIuXG4gIC8vIE90aGVyd2lzZSwgJGJpdHNBbGxTZXQgd2lsbCByZXR1cm4gYW4gZXJyb3IuXG4gIGlmIChOdW1iZXIuaXNJbnRlZ2VyKG9wZXJhbmQpICYmIG9wZXJhbmQgPj0gMCkge1xuICAgIHJldHVybiBuZXcgVWludDhBcnJheShuZXcgSW50MzJBcnJheShbb3BlcmFuZF0pLmJ1ZmZlcik7XG4gIH1cblxuICAvLyBiaW5kYXRhIGJpdG1hc2tcbiAgLy8gWW91IGNhbiBhbHNvIHVzZSBhbiBhcmJpdHJhcmlseSBsYXJnZSBCaW5EYXRhIGluc3RhbmNlIGFzIGEgYml0bWFzay5cbiAgaWYgKEVKU09OLmlzQmluYXJ5KG9wZXJhbmQpKSB7XG4gICAgcmV0dXJuIG5ldyBVaW50OEFycmF5KG9wZXJhbmQuYnVmZmVyKTtcbiAgfVxuXG4gIC8vIHBvc2l0aW9uIGxpc3RcbiAgLy8gSWYgcXVlcnlpbmcgYSBsaXN0IG9mIGJpdCBwb3NpdGlvbnMsIGVhY2ggPHBvc2l0aW9uPiBtdXN0IGJlIGEgbm9uLW5lZ2F0aXZlXG4gIC8vIGludGVnZXIuIEJpdCBwb3NpdGlvbnMgc3RhcnQgYXQgMCBmcm9tIHRoZSBsZWFzdCBzaWduaWZpY2FudCBiaXQuXG4gIGlmIChBcnJheS5pc0FycmF5KG9wZXJhbmQpICYmXG4gICAgICBvcGVyYW5kLmV2ZXJ5KHggPT4gTnVtYmVyLmlzSW50ZWdlcih4KSAmJiB4ID49IDApKSB7XG4gICAgY29uc3QgYnVmZmVyID0gbmV3IEFycmF5QnVmZmVyKChNYXRoLm1heCguLi5vcGVyYW5kKSA+PiAzKSArIDEpO1xuICAgIGNvbnN0IHZpZXcgPSBuZXcgVWludDhBcnJheShidWZmZXIpO1xuXG4gICAgb3BlcmFuZC5mb3JFYWNoKHggPT4ge1xuICAgICAgdmlld1t4ID4+IDNdIHw9IDEgPDwgKHggJiAweDcpO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIHZpZXc7XG4gIH1cblxuICAvLyBiYWQgb3BlcmFuZFxuICB0aHJvdyBFcnJvcihcbiAgICBgb3BlcmFuZCB0byAke3NlbGVjdG9yfSBtdXN0IGJlIGEgbnVtZXJpYyBiaXRtYXNrIChyZXByZXNlbnRhYmxlIGFzIGEgYCArXG4gICAgJ25vbi1uZWdhdGl2ZSAzMi1iaXQgc2lnbmVkIGludGVnZXIpLCBhIGJpbmRhdGEgYml0bWFzayBvciBhbiBhcnJheSB3aXRoICcgK1xuICAgICdiaXQgcG9zaXRpb25zIChub24tbmVnYXRpdmUgaW50ZWdlcnMpJ1xuICApO1xufVxuXG5mdW5jdGlvbiBnZXRWYWx1ZUJpdG1hc2sodmFsdWUsIGxlbmd0aCkge1xuICAvLyBUaGUgZmllbGQgdmFsdWUgbXVzdCBiZSBlaXRoZXIgbnVtZXJpY2FsIG9yIGEgQmluRGF0YSBpbnN0YW5jZS4gT3RoZXJ3aXNlLFxuICAvLyAkYml0cy4uLiB3aWxsIG5vdCBtYXRjaCB0aGUgY3VycmVudCBkb2N1bWVudC5cblxuICAvLyBudW1lcmljYWxcbiAgaWYgKE51bWJlci5pc1NhZmVJbnRlZ2VyKHZhbHVlKSkge1xuICAgIC8vICRiaXRzLi4uIHdpbGwgbm90IG1hdGNoIG51bWVyaWNhbCB2YWx1ZXMgdGhhdCBjYW5ub3QgYmUgcmVwcmVzZW50ZWQgYXMgYVxuICAgIC8vIHNpZ25lZCA2NC1iaXQgaW50ZWdlci4gVGhpcyBjYW4gYmUgdGhlIGNhc2UgaWYgYSB2YWx1ZSBpcyBlaXRoZXIgdG9vXG4gICAgLy8gbGFyZ2Ugb3Igc21hbGwgdG8gZml0IGluIGEgc2lnbmVkIDY0LWJpdCBpbnRlZ2VyLCBvciBpZiBpdCBoYXMgYVxuICAgIC8vIGZyYWN0aW9uYWwgY29tcG9uZW50LlxuICAgIGNvbnN0IGJ1ZmZlciA9IG5ldyBBcnJheUJ1ZmZlcihcbiAgICAgIE1hdGgubWF4KGxlbmd0aCwgMiAqIFVpbnQzMkFycmF5LkJZVEVTX1BFUl9FTEVNRU5UKVxuICAgICk7XG5cbiAgICBsZXQgdmlldyA9IG5ldyBVaW50MzJBcnJheShidWZmZXIsIDAsIDIpO1xuICAgIHZpZXdbMF0gPSB2YWx1ZSAlICgoMSA8PCAxNikgKiAoMSA8PCAxNikpIHwgMDtcbiAgICB2aWV3WzFdID0gdmFsdWUgLyAoKDEgPDwgMTYpICogKDEgPDwgMTYpKSB8IDA7XG5cbiAgICAvLyBzaWduIGV4dGVuc2lvblxuICAgIGlmICh2YWx1ZSA8IDApIHtcbiAgICAgIHZpZXcgPSBuZXcgVWludDhBcnJheShidWZmZXIsIDIpO1xuICAgICAgdmlldy5mb3JFYWNoKChieXRlLCBpKSA9PiB7XG4gICAgICAgIHZpZXdbaV0gPSAweGZmO1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIG5ldyBVaW50OEFycmF5KGJ1ZmZlcik7XG4gIH1cblxuICAvLyBiaW5kYXRhXG4gIGlmIChFSlNPTi5pc0JpbmFyeSh2YWx1ZSkpIHtcbiAgICByZXR1cm4gbmV3IFVpbnQ4QXJyYXkodmFsdWUuYnVmZmVyKTtcbiAgfVxuXG4gIC8vIG5vIG1hdGNoXG4gIHJldHVybiBmYWxzZTtcbn1cblxuLy8gQWN0dWFsbHkgaW5zZXJ0cyBhIGtleSB2YWx1ZSBpbnRvIHRoZSBzZWxlY3RvciBkb2N1bWVudFxuLy8gSG93ZXZlciwgdGhpcyBjaGVja3MgdGhlcmUgaXMgbm8gYW1iaWd1aXR5IGluIHNldHRpbmdcbi8vIHRoZSB2YWx1ZSBmb3IgdGhlIGdpdmVuIGtleSwgdGhyb3dzIG90aGVyd2lzZVxuZnVuY3Rpb24gaW5zZXJ0SW50b0RvY3VtZW50KGRvY3VtZW50LCBrZXksIHZhbHVlKSB7XG4gIE9iamVjdC5rZXlzKGRvY3VtZW50KS5mb3JFYWNoKGV4aXN0aW5nS2V5ID0+IHtcbiAgICBpZiAoXG4gICAgICAoZXhpc3RpbmdLZXkubGVuZ3RoID4ga2V5Lmxlbmd0aCAmJiBleGlzdGluZ0tleS5pbmRleE9mKGAke2tleX0uYCkgPT09IDApIHx8XG4gICAgICAoa2V5Lmxlbmd0aCA+IGV4aXN0aW5nS2V5Lmxlbmd0aCAmJiBrZXkuaW5kZXhPZihgJHtleGlzdGluZ0tleX0uYCkgPT09IDApXG4gICAgKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIGBjYW5ub3QgaW5mZXIgcXVlcnkgZmllbGRzIHRvIHNldCwgYm90aCBwYXRocyAnJHtleGlzdGluZ0tleX0nIGFuZCBgICtcbiAgICAgICAgYCcke2tleX0nIGFyZSBtYXRjaGVkYFxuICAgICAgKTtcbiAgICB9IGVsc2UgaWYgKGV4aXN0aW5nS2V5ID09PSBrZXkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgYGNhbm5vdCBpbmZlciBxdWVyeSBmaWVsZHMgdG8gc2V0LCBwYXRoICcke2tleX0nIGlzIG1hdGNoZWQgdHdpY2VgXG4gICAgICApO1xuICAgIH1cbiAgfSk7XG5cbiAgZG9jdW1lbnRba2V5XSA9IHZhbHVlO1xufVxuXG4vLyBSZXR1cm5zIGEgYnJhbmNoZWQgbWF0Y2hlciB0aGF0IG1hdGNoZXMgaWZmIHRoZSBnaXZlbiBtYXRjaGVyIGRvZXMgbm90LlxuLy8gTm90ZSB0aGF0IHRoaXMgaW1wbGljaXRseSBcImRlTW9yZ2FuaXplc1wiIHRoZSB3cmFwcGVkIGZ1bmN0aW9uLiAgaWUsIGl0XG4vLyBtZWFucyB0aGF0IEFMTCBicmFuY2ggdmFsdWVzIG5lZWQgdG8gZmFpbCB0byBtYXRjaCBpbm5lckJyYW5jaGVkTWF0Y2hlci5cbmZ1bmN0aW9uIGludmVydEJyYW5jaGVkTWF0Y2hlcihicmFuY2hlZE1hdGNoZXIpIHtcbiAgcmV0dXJuIGJyYW5jaFZhbHVlcyA9PiB7XG4gICAgLy8gV2UgZXhwbGljaXRseSBjaG9vc2UgdG8gc3RyaXAgYXJyYXlJbmRpY2VzIGhlcmU6IGl0IGRvZXNuJ3QgbWFrZSBzZW5zZSB0b1xuICAgIC8vIHNheSBcInVwZGF0ZSB0aGUgYXJyYXkgZWxlbWVudCB0aGF0IGRvZXMgbm90IG1hdGNoIHNvbWV0aGluZ1wiLCBhdCBsZWFzdFxuICAgIC8vIGluIG1vbmdvLWxhbmQuXG4gICAgcmV0dXJuIHtyZXN1bHQ6ICFicmFuY2hlZE1hdGNoZXIoYnJhbmNoVmFsdWVzKS5yZXN1bHR9O1xuICB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNJbmRleGFibGUob2JqKSB7XG4gIHJldHVybiBBcnJheS5pc0FycmF5KG9iaikgfHwgTG9jYWxDb2xsZWN0aW9uLl9pc1BsYWluT2JqZWN0KG9iaik7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc051bWVyaWNLZXkocykge1xuICByZXR1cm4gL15bMC05XSskLy50ZXN0KHMpO1xufVxuXG4vLyBSZXR1cm5zIHRydWUgaWYgdGhpcyBpcyBhbiBvYmplY3Qgd2l0aCBhdCBsZWFzdCBvbmUga2V5IGFuZCBhbGwga2V5cyBiZWdpblxuLy8gd2l0aCAkLiAgVW5sZXNzIGluY29uc2lzdGVudE9LIGlzIHNldCwgdGhyb3dzIGlmIHNvbWUga2V5cyBiZWdpbiB3aXRoICQgYW5kXG4vLyBvdGhlcnMgZG9uJ3QuXG5leHBvcnQgZnVuY3Rpb24gaXNPcGVyYXRvck9iamVjdCh2YWx1ZVNlbGVjdG9yLCBpbmNvbnNpc3RlbnRPSykge1xuICBpZiAoIUxvY2FsQ29sbGVjdGlvbi5faXNQbGFpbk9iamVjdCh2YWx1ZVNlbGVjdG9yKSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGxldCB0aGVzZUFyZU9wZXJhdG9ycyA9IHVuZGVmaW5lZDtcbiAgT2JqZWN0LmtleXModmFsdWVTZWxlY3RvcikuZm9yRWFjaChzZWxLZXkgPT4ge1xuICAgIGNvbnN0IHRoaXNJc09wZXJhdG9yID0gc2VsS2V5LnN1YnN0cigwLCAxKSA9PT0gJyQnO1xuXG4gICAgaWYgKHRoZXNlQXJlT3BlcmF0b3JzID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoZXNlQXJlT3BlcmF0b3JzID0gdGhpc0lzT3BlcmF0b3I7XG4gICAgfSBlbHNlIGlmICh0aGVzZUFyZU9wZXJhdG9ycyAhPT0gdGhpc0lzT3BlcmF0b3IpIHtcbiAgICAgIGlmICghaW5jb25zaXN0ZW50T0spIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgIGBJbmNvbnNpc3RlbnQgb3BlcmF0b3I6ICR7SlNPTi5zdHJpbmdpZnkodmFsdWVTZWxlY3Rvcil9YFxuICAgICAgICApO1xuICAgICAgfVxuXG4gICAgICB0aGVzZUFyZU9wZXJhdG9ycyA9IGZhbHNlO1xuICAgIH1cbiAgfSk7XG5cbiAgcmV0dXJuICEhdGhlc2VBcmVPcGVyYXRvcnM7IC8vIHt9IGhhcyBubyBvcGVyYXRvcnNcbn1cblxuLy8gSGVscGVyIGZvciAkbHQvJGd0LyRsdGUvJGd0ZS5cbmZ1bmN0aW9uIG1ha2VJbmVxdWFsaXR5KGNtcFZhbHVlQ29tcGFyYXRvcikge1xuICByZXR1cm4ge1xuICAgIGNvbXBpbGVFbGVtZW50U2VsZWN0b3Iob3BlcmFuZCkge1xuICAgICAgLy8gQXJyYXlzIG5ldmVyIGNvbXBhcmUgZmFsc2Ugd2l0aCBub24tYXJyYXlzIGZvciBhbnkgaW5lcXVhbGl0eS5cbiAgICAgIC8vIFhYWCBUaGlzIHdhcyBiZWhhdmlvciB3ZSBvYnNlcnZlZCBpbiBwcmUtcmVsZWFzZSBNb25nb0RCIDIuNSwgYnV0XG4gICAgICAvLyAgICAgaXQgc2VlbXMgdG8gaGF2ZSBiZWVuIHJldmVydGVkLlxuICAgICAgLy8gICAgIFNlZSBodHRwczovL2ppcmEubW9uZ29kYi5vcmcvYnJvd3NlL1NFUlZFUi0xMTQ0NFxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkob3BlcmFuZCkpIHtcbiAgICAgICAgcmV0dXJuICgpID0+IGZhbHNlO1xuICAgICAgfVxuXG4gICAgICAvLyBTcGVjaWFsIGNhc2U6IGNvbnNpZGVyIHVuZGVmaW5lZCBhbmQgbnVsbCB0aGUgc2FtZSAoc28gdHJ1ZSB3aXRoXG4gICAgICAvLyAkZ3RlLyRsdGUpLlxuICAgICAgaWYgKG9wZXJhbmQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICBvcGVyYW5kID0gbnVsbDtcbiAgICAgIH1cblxuICAgICAgY29uc3Qgb3BlcmFuZFR5cGUgPSBMb2NhbENvbGxlY3Rpb24uX2YuX3R5cGUob3BlcmFuZCk7XG5cbiAgICAgIHJldHVybiB2YWx1ZSA9PiB7XG4gICAgICAgIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgdmFsdWUgPSBudWxsO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ29tcGFyaXNvbnMgYXJlIG5ldmVyIHRydWUgYW1vbmcgdGhpbmdzIG9mIGRpZmZlcmVudCB0eXBlIChleGNlcHRcbiAgICAgICAgLy8gbnVsbCB2cyB1bmRlZmluZWQpLlxuICAgICAgICBpZiAoTG9jYWxDb2xsZWN0aW9uLl9mLl90eXBlKHZhbHVlKSAhPT0gb3BlcmFuZFR5cGUpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gY21wVmFsdWVDb21wYXJhdG9yKExvY2FsQ29sbGVjdGlvbi5fZi5fY21wKHZhbHVlLCBvcGVyYW5kKSk7XG4gICAgICB9O1xuICAgIH0sXG4gIH07XG59XG5cbi8vIG1ha2VMb29rdXBGdW5jdGlvbihrZXkpIHJldHVybnMgYSBsb29rdXAgZnVuY3Rpb24uXG4vL1xuLy8gQSBsb29rdXAgZnVuY3Rpb24gdGFrZXMgaW4gYSBkb2N1bWVudCBhbmQgcmV0dXJucyBhbiBhcnJheSBvZiBtYXRjaGluZ1xuLy8gYnJhbmNoZXMuICBJZiBubyBhcnJheXMgYXJlIGZvdW5kIHdoaWxlIGxvb2tpbmcgdXAgdGhlIGtleSwgdGhpcyBhcnJheSB3aWxsXG4vLyBoYXZlIGV4YWN0bHkgb25lIGJyYW5jaGVzIChwb3NzaWJseSAndW5kZWZpbmVkJywgaWYgc29tZSBzZWdtZW50IG9mIHRoZSBrZXlcbi8vIHdhcyBub3QgZm91bmQpLlxuLy9cbi8vIElmIGFycmF5cyBhcmUgZm91bmQgaW4gdGhlIG1pZGRsZSwgdGhpcyBjYW4gaGF2ZSBtb3JlIHRoYW4gb25lIGVsZW1lbnQsIHNpbmNlXG4vLyB3ZSAnYnJhbmNoJy4gV2hlbiB3ZSAnYnJhbmNoJywgaWYgdGhlcmUgYXJlIG1vcmUga2V5IHNlZ21lbnRzIHRvIGxvb2sgdXAsXG4vLyB0aGVuIHdlIG9ubHkgcHVyc3VlIGJyYW5jaGVzIHRoYXQgYXJlIHBsYWluIG9iamVjdHMgKG5vdCBhcnJheXMgb3Igc2NhbGFycykuXG4vLyBUaGlzIG1lYW5zIHdlIGNhbiBhY3R1YWxseSBlbmQgdXAgd2l0aCBubyBicmFuY2hlcyFcbi8vXG4vLyBXZSBkbyAqTk9UKiBicmFuY2ggb24gYXJyYXlzIHRoYXQgYXJlIGZvdW5kIGF0IHRoZSBlbmQgKGllLCBhdCB0aGUgbGFzdFxuLy8gZG90dGVkIG1lbWJlciBvZiB0aGUga2V5KS4gV2UganVzdCByZXR1cm4gdGhhdCBhcnJheTsgaWYgeW91IHdhbnQgdG9cbi8vIGVmZmVjdGl2ZWx5ICdicmFuY2gnIG92ZXIgdGhlIGFycmF5J3MgdmFsdWVzLCBwb3N0LXByb2Nlc3MgdGhlIGxvb2t1cFxuLy8gZnVuY3Rpb24gd2l0aCBleHBhbmRBcnJheXNJbkJyYW5jaGVzLlxuLy9cbi8vIEVhY2ggYnJhbmNoIGlzIGFuIG9iamVjdCB3aXRoIGtleXM6XG4vLyAgLSB2YWx1ZTogdGhlIHZhbHVlIGF0IHRoZSBicmFuY2hcbi8vICAtIGRvbnRJdGVyYXRlOiBhbiBvcHRpb25hbCBib29sOyBpZiB0cnVlLCBpdCBtZWFucyB0aGF0ICd2YWx1ZScgaXMgYW4gYXJyYXlcbi8vICAgIHRoYXQgZXhwYW5kQXJyYXlzSW5CcmFuY2hlcyBzaG91bGQgTk9UIGV4cGFuZC4gVGhpcyBzcGVjaWZpY2FsbHkgaGFwcGVuc1xuLy8gICAgd2hlbiB0aGVyZSBpcyBhIG51bWVyaWMgaW5kZXggaW4gdGhlIGtleSwgYW5kIGVuc3VyZXMgdGhlXG4vLyAgICBwZXJoYXBzLXN1cnByaXNpbmcgTW9uZ29EQiBiZWhhdmlvciB3aGVyZSB7J2EuMCc6IDV9IGRvZXMgTk9UXG4vLyAgICBtYXRjaCB7YTogW1s1XV19LlxuLy8gIC0gYXJyYXlJbmRpY2VzOiBpZiBhbnkgYXJyYXkgaW5kZXhpbmcgd2FzIGRvbmUgZHVyaW5nIGxvb2t1cCAoZWl0aGVyIGR1ZSB0b1xuLy8gICAgZXhwbGljaXQgbnVtZXJpYyBpbmRpY2VzIG9yIGltcGxpY2l0IGJyYW5jaGluZyksIHRoaXMgd2lsbCBiZSBhbiBhcnJheSBvZlxuLy8gICAgdGhlIGFycmF5IGluZGljZXMgdXNlZCwgZnJvbSBvdXRlcm1vc3QgdG8gaW5uZXJtb3N0OyBpdCBpcyBmYWxzZXkgb3Jcbi8vICAgIGFic2VudCBpZiBubyBhcnJheSBpbmRleCBpcyB1c2VkLiBJZiBhbiBleHBsaWNpdCBudW1lcmljIGluZGV4IGlzIHVzZWQsXG4vLyAgICB0aGUgaW5kZXggd2lsbCBiZSBmb2xsb3dlZCBpbiBhcnJheUluZGljZXMgYnkgdGhlIHN0cmluZyAneCcuXG4vL1xuLy8gICAgTm90ZTogYXJyYXlJbmRpY2VzIGlzIHVzZWQgZm9yIHR3byBwdXJwb3Nlcy4gRmlyc3QsIGl0IGlzIHVzZWQgdG9cbi8vICAgIGltcGxlbWVudCB0aGUgJyQnIG1vZGlmaWVyIGZlYXR1cmUsIHdoaWNoIG9ubHkgZXZlciBsb29rcyBhdCBpdHMgZmlyc3Rcbi8vICAgIGVsZW1lbnQuXG4vL1xuLy8gICAgU2Vjb25kLCBpdCBpcyB1c2VkIGZvciBzb3J0IGtleSBnZW5lcmF0aW9uLCB3aGljaCBuZWVkcyB0byBiZSBhYmxlIHRvIHRlbGxcbi8vICAgIHRoZSBkaWZmZXJlbmNlIGJldHdlZW4gZGlmZmVyZW50IHBhdGhzLiBNb3Jlb3ZlciwgaXQgbmVlZHMgdG9cbi8vICAgIGRpZmZlcmVudGlhdGUgYmV0d2VlbiBleHBsaWNpdCBhbmQgaW1wbGljaXQgYnJhbmNoaW5nLCB3aGljaCBpcyB3aHlcbi8vICAgIHRoZXJlJ3MgdGhlIHNvbWV3aGF0IGhhY2t5ICd4JyBlbnRyeTogdGhpcyBtZWFucyB0aGF0IGV4cGxpY2l0IGFuZFxuLy8gICAgaW1wbGljaXQgYXJyYXkgbG9va3VwcyB3aWxsIGhhdmUgZGlmZmVyZW50IGZ1bGwgYXJyYXlJbmRpY2VzIHBhdGhzLiAoVGhhdFxuLy8gICAgY29kZSBvbmx5IHJlcXVpcmVzIHRoYXQgZGlmZmVyZW50IHBhdGhzIGhhdmUgZGlmZmVyZW50IGFycmF5SW5kaWNlczsgaXRcbi8vICAgIGRvZXNuJ3QgYWN0dWFsbHkgJ3BhcnNlJyBhcnJheUluZGljZXMuIEFzIGFuIGFsdGVybmF0aXZlLCBhcnJheUluZGljZXNcbi8vICAgIGNvdWxkIGNvbnRhaW4gb2JqZWN0cyB3aXRoIGZsYWdzIGxpa2UgJ2ltcGxpY2l0JywgYnV0IEkgdGhpbmsgdGhhdCBvbmx5XG4vLyAgICBtYWtlcyB0aGUgY29kZSBzdXJyb3VuZGluZyB0aGVtIG1vcmUgY29tcGxleC4pXG4vL1xuLy8gICAgKEJ5IHRoZSB3YXksIHRoaXMgZmllbGQgZW5kcyB1cCBnZXR0aW5nIHBhc3NlZCBhcm91bmQgYSBsb3Qgd2l0aG91dFxuLy8gICAgY2xvbmluZywgc28gbmV2ZXIgbXV0YXRlIGFueSBhcnJheUluZGljZXMgZmllbGQvdmFyIGluIHRoaXMgcGFja2FnZSEpXG4vL1xuLy9cbi8vIEF0IHRoZSB0b3AgbGV2ZWwsIHlvdSBtYXkgb25seSBwYXNzIGluIGEgcGxhaW4gb2JqZWN0IG9yIGFycmF5LlxuLy9cbi8vIFNlZSB0aGUgdGVzdCAnbWluaW1vbmdvIC0gbG9va3VwJyBmb3Igc29tZSBleGFtcGxlcyBvZiB3aGF0IGxvb2t1cCBmdW5jdGlvbnNcbi8vIHJldHVybi5cbmV4cG9ydCBmdW5jdGlvbiBtYWtlTG9va3VwRnVuY3Rpb24oa2V5LCBvcHRpb25zID0ge30pIHtcbiAgY29uc3QgcGFydHMgPSBrZXkuc3BsaXQoJy4nKTtcbiAgY29uc3QgZmlyc3RQYXJ0ID0gcGFydHMubGVuZ3RoID8gcGFydHNbMF0gOiAnJztcbiAgY29uc3QgbG9va3VwUmVzdCA9IChcbiAgICBwYXJ0cy5sZW5ndGggPiAxICYmXG4gICAgbWFrZUxvb2t1cEZ1bmN0aW9uKHBhcnRzLnNsaWNlKDEpLmpvaW4oJy4nKSlcbiAgKTtcblxuICBjb25zdCBvbWl0VW5uZWNlc3NhcnlGaWVsZHMgPSByZXN1bHQgPT4ge1xuICAgIGlmICghcmVzdWx0LmRvbnRJdGVyYXRlKSB7XG4gICAgICBkZWxldGUgcmVzdWx0LmRvbnRJdGVyYXRlO1xuICAgIH1cblxuICAgIGlmIChyZXN1bHQuYXJyYXlJbmRpY2VzICYmICFyZXN1bHQuYXJyYXlJbmRpY2VzLmxlbmd0aCkge1xuICAgICAgZGVsZXRlIHJlc3VsdC5hcnJheUluZGljZXM7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfTtcblxuICAvLyBEb2Mgd2lsbCBhbHdheXMgYmUgYSBwbGFpbiBvYmplY3Qgb3IgYW4gYXJyYXkuXG4gIC8vIGFwcGx5IGFuIGV4cGxpY2l0IG51bWVyaWMgaW5kZXgsIGFuIGFycmF5LlxuICByZXR1cm4gKGRvYywgYXJyYXlJbmRpY2VzID0gW10pID0+IHtcbiAgICBpZiAoQXJyYXkuaXNBcnJheShkb2MpKSB7XG4gICAgICAvLyBJZiB3ZSdyZSBiZWluZyBhc2tlZCB0byBkbyBhbiBpbnZhbGlkIGxvb2t1cCBpbnRvIGFuIGFycmF5IChub24taW50ZWdlclxuICAgICAgLy8gb3Igb3V0LW9mLWJvdW5kcyksIHJldHVybiBubyByZXN1bHRzICh3aGljaCBpcyBkaWZmZXJlbnQgZnJvbSByZXR1cm5pbmdcbiAgICAgIC8vIGEgc2luZ2xlIHVuZGVmaW5lZCByZXN1bHQsIGluIHRoYXQgYG51bGxgIGVxdWFsaXR5IGNoZWNrcyB3b24ndCBtYXRjaCkuXG4gICAgICBpZiAoIShpc051bWVyaWNLZXkoZmlyc3RQYXJ0KSAmJiBmaXJzdFBhcnQgPCBkb2MubGVuZ3RoKSkge1xuICAgICAgICByZXR1cm4gW107XG4gICAgICB9XG5cbiAgICAgIC8vIFJlbWVtYmVyIHRoYXQgd2UgdXNlZCB0aGlzIGFycmF5IGluZGV4LiBJbmNsdWRlIGFuICd4JyB0byBpbmRpY2F0ZSB0aGF0XG4gICAgICAvLyB0aGUgcHJldmlvdXMgaW5kZXggY2FtZSBmcm9tIGJlaW5nIGNvbnNpZGVyZWQgYXMgYW4gZXhwbGljaXQgYXJyYXlcbiAgICAgIC8vIGluZGV4IChub3QgYnJhbmNoaW5nKS5cbiAgICAgIGFycmF5SW5kaWNlcyA9IGFycmF5SW5kaWNlcy5jb25jYXQoK2ZpcnN0UGFydCwgJ3gnKTtcbiAgICB9XG5cbiAgICAvLyBEbyBvdXIgZmlyc3QgbG9va3VwLlxuICAgIGNvbnN0IGZpcnN0TGV2ZWwgPSBkb2NbZmlyc3RQYXJ0XTtcblxuICAgIC8vIElmIHRoZXJlIGlzIG5vIGRlZXBlciB0byBkaWcsIHJldHVybiB3aGF0IHdlIGZvdW5kLlxuICAgIC8vXG4gICAgLy8gSWYgd2hhdCB3ZSBmb3VuZCBpcyBhbiBhcnJheSwgbW9zdCB2YWx1ZSBzZWxlY3RvcnMgd2lsbCBjaG9vc2UgdG8gdHJlYXRcbiAgICAvLyB0aGUgZWxlbWVudHMgb2YgdGhlIGFycmF5IGFzIG1hdGNoYWJsZSB2YWx1ZXMgaW4gdGhlaXIgb3duIHJpZ2h0LCBidXRcbiAgICAvLyB0aGF0J3MgZG9uZSBvdXRzaWRlIG9mIHRoZSBsb29rdXAgZnVuY3Rpb24uIChFeGNlcHRpb25zIHRvIHRoaXMgYXJlICRzaXplXG4gICAgLy8gYW5kIHN0dWZmIHJlbGF0aW5nIHRvICRlbGVtTWF0Y2guICBlZywge2E6IHskc2l6ZTogMn19IGRvZXMgbm90IG1hdGNoIHthOlxuICAgIC8vIFtbMSwgMl1dfS4pXG4gICAgLy9cbiAgICAvLyBUaGF0IHNhaWQsIGlmIHdlIGp1c3QgZGlkIGFuICpleHBsaWNpdCogYXJyYXkgbG9va3VwIChvbiBkb2MpIHRvIGZpbmRcbiAgICAvLyBmaXJzdExldmVsLCBhbmQgZmlyc3RMZXZlbCBpcyBhbiBhcnJheSB0b28sIHdlIGRvIE5PVCB3YW50IHZhbHVlXG4gICAgLy8gc2VsZWN0b3JzIHRvIGl0ZXJhdGUgb3ZlciBpdC4gIGVnLCB7J2EuMCc6IDV9IGRvZXMgbm90IG1hdGNoIHthOiBbWzVdXX0uXG4gICAgLy8gU28gaW4gdGhhdCBjYXNlLCB3ZSBtYXJrIHRoZSByZXR1cm4gdmFsdWUgYXMgJ2Rvbid0IGl0ZXJhdGUnLlxuICAgIGlmICghbG9va3VwUmVzdCkge1xuICAgICAgcmV0dXJuIFtvbWl0VW5uZWNlc3NhcnlGaWVsZHMoe1xuICAgICAgICBhcnJheUluZGljZXMsXG4gICAgICAgIGRvbnRJdGVyYXRlOiBBcnJheS5pc0FycmF5KGRvYykgJiYgQXJyYXkuaXNBcnJheShmaXJzdExldmVsKSxcbiAgICAgICAgdmFsdWU6IGZpcnN0TGV2ZWxcbiAgICAgIH0pXTtcbiAgICB9XG5cbiAgICAvLyBXZSBuZWVkIHRvIGRpZyBkZWVwZXIuICBCdXQgaWYgd2UgY2FuJ3QsIGJlY2F1c2Ugd2hhdCB3ZSd2ZSBmb3VuZCBpcyBub3RcbiAgICAvLyBhbiBhcnJheSBvciBwbGFpbiBvYmplY3QsIHdlJ3JlIGRvbmUuIElmIHdlIGp1c3QgZGlkIGEgbnVtZXJpYyBpbmRleCBpbnRvXG4gICAgLy8gYW4gYXJyYXksIHdlIHJldHVybiBub3RoaW5nIGhlcmUgKHRoaXMgaXMgYSBjaGFuZ2UgaW4gTW9uZ28gMi41IGZyb21cbiAgICAvLyBNb25nbyAyLjQsIHdoZXJlIHsnYS4wLmInOiBudWxsfSBzdG9wcGVkIG1hdGNoaW5nIHthOiBbNV19KS4gT3RoZXJ3aXNlLFxuICAgIC8vIHJldHVybiBhIHNpbmdsZSBgdW5kZWZpbmVkYCAod2hpY2ggY2FuLCBmb3IgZXhhbXBsZSwgbWF0Y2ggdmlhIGVxdWFsaXR5XG4gICAgLy8gd2l0aCBgbnVsbGApLlxuICAgIGlmICghaXNJbmRleGFibGUoZmlyc3RMZXZlbCkpIHtcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KGRvYykpIHtcbiAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gW29taXRVbm5lY2Vzc2FyeUZpZWxkcyh7YXJyYXlJbmRpY2VzLCB2YWx1ZTogdW5kZWZpbmVkfSldO1xuICAgIH1cblxuICAgIGNvbnN0IHJlc3VsdCA9IFtdO1xuICAgIGNvbnN0IGFwcGVuZFRvUmVzdWx0ID0gbW9yZSA9PiB7XG4gICAgICByZXN1bHQucHVzaCguLi5tb3JlKTtcbiAgICB9O1xuXG4gICAgLy8gRGlnIGRlZXBlcjogbG9vayB1cCB0aGUgcmVzdCBvZiB0aGUgcGFydHMgb24gd2hhdGV2ZXIgd2UndmUgZm91bmQuXG4gICAgLy8gKGxvb2t1cFJlc3QgaXMgc21hcnQgZW5vdWdoIHRvIG5vdCB0cnkgdG8gZG8gaW52YWxpZCBsb29rdXBzIGludG9cbiAgICAvLyBmaXJzdExldmVsIGlmIGl0J3MgYW4gYXJyYXkuKVxuICAgIGFwcGVuZFRvUmVzdWx0KGxvb2t1cFJlc3QoZmlyc3RMZXZlbCwgYXJyYXlJbmRpY2VzKSk7XG5cbiAgICAvLyBJZiB3ZSBmb3VuZCBhbiBhcnJheSwgdGhlbiBpbiAqYWRkaXRpb24qIHRvIHBvdGVudGlhbGx5IHRyZWF0aW5nIHRoZSBuZXh0XG4gICAgLy8gcGFydCBhcyBhIGxpdGVyYWwgaW50ZWdlciBsb29rdXAsIHdlIHNob3VsZCBhbHNvICdicmFuY2gnOiB0cnkgdG8gbG9vayB1cFxuICAgIC8vIHRoZSByZXN0IG9mIHRoZSBwYXJ0cyBvbiBlYWNoIGFycmF5IGVsZW1lbnQgaW4gcGFyYWxsZWwuXG4gICAgLy9cbiAgICAvLyBJbiB0aGlzIGNhc2UsIHdlICpvbmx5KiBkaWcgZGVlcGVyIGludG8gYXJyYXkgZWxlbWVudHMgdGhhdCBhcmUgcGxhaW5cbiAgICAvLyBvYmplY3RzLiAoUmVjYWxsIHRoYXQgd2Ugb25seSBnb3QgdGhpcyBmYXIgaWYgd2UgaGF2ZSBmdXJ0aGVyIHRvIGRpZy4pXG4gICAgLy8gVGhpcyBtYWtlcyBzZW5zZTogd2UgY2VydGFpbmx5IGRvbid0IGRpZyBkZWVwZXIgaW50byBub24taW5kZXhhYmxlXG4gICAgLy8gb2JqZWN0cy4gQW5kIGl0IHdvdWxkIGJlIHdlaXJkIHRvIGRpZyBpbnRvIGFuIGFycmF5OiBpdCdzIHNpbXBsZXIgdG8gaGF2ZVxuICAgIC8vIGEgcnVsZSB0aGF0IGV4cGxpY2l0IGludGVnZXIgaW5kZXhlcyBvbmx5IGFwcGx5IHRvIGFuIG91dGVyIGFycmF5LCBub3QgdG9cbiAgICAvLyBhbiBhcnJheSB5b3UgZmluZCBhZnRlciBhIGJyYW5jaGluZyBzZWFyY2guXG4gICAgLy9cbiAgICAvLyBJbiB0aGUgc3BlY2lhbCBjYXNlIG9mIGEgbnVtZXJpYyBwYXJ0IGluIGEgKnNvcnQgc2VsZWN0b3IqIChub3QgYSBxdWVyeVxuICAgIC8vIHNlbGVjdG9yKSwgd2Ugc2tpcCB0aGUgYnJhbmNoaW5nOiB3ZSBPTkxZIGFsbG93IHRoZSBudW1lcmljIHBhcnQgdG8gbWVhblxuICAgIC8vICdsb29rIHVwIHRoaXMgaW5kZXgnIGluIHRoYXQgY2FzZSwgbm90ICdhbHNvIGxvb2sgdXAgdGhpcyBpbmRleCBpbiBhbGxcbiAgICAvLyB0aGUgZWxlbWVudHMgb2YgdGhlIGFycmF5Jy5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShmaXJzdExldmVsKSAmJlxuICAgICAgICAhKGlzTnVtZXJpY0tleShwYXJ0c1sxXSkgJiYgb3B0aW9ucy5mb3JTb3J0KSkge1xuICAgICAgZmlyc3RMZXZlbC5mb3JFYWNoKChicmFuY2gsIGFycmF5SW5kZXgpID0+IHtcbiAgICAgICAgaWYgKExvY2FsQ29sbGVjdGlvbi5faXNQbGFpbk9iamVjdChicmFuY2gpKSB7XG4gICAgICAgICAgYXBwZW5kVG9SZXN1bHQobG9va3VwUmVzdChicmFuY2gsIGFycmF5SW5kaWNlcy5jb25jYXQoYXJyYXlJbmRleCkpKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfTtcbn1cblxuLy8gT2JqZWN0IGV4cG9ydGVkIG9ubHkgZm9yIHVuaXQgdGVzdGluZy5cbi8vIFVzZSBpdCB0byBleHBvcnQgcHJpdmF0ZSBmdW5jdGlvbnMgdG8gdGVzdCBpbiBUaW55dGVzdC5cbk1pbmltb25nb1Rlc3QgPSB7bWFrZUxvb2t1cEZ1bmN0aW9ufTtcbk1pbmltb25nb0Vycm9yID0gKG1lc3NhZ2UsIG9wdGlvbnMgPSB7fSkgPT4ge1xuICBpZiAodHlwZW9mIG1lc3NhZ2UgPT09ICdzdHJpbmcnICYmIG9wdGlvbnMuZmllbGQpIHtcbiAgICBtZXNzYWdlICs9IGAgZm9yIGZpZWxkICcke29wdGlvbnMuZmllbGR9J2A7XG4gIH1cblxuICBjb25zdCBlcnJvciA9IG5ldyBFcnJvcihtZXNzYWdlKTtcbiAgZXJyb3IubmFtZSA9ICdNaW5pbW9uZ29FcnJvcic7XG4gIHJldHVybiBlcnJvcjtcbn07XG5cbmV4cG9ydCBmdW5jdGlvbiBub3RoaW5nTWF0Y2hlcihkb2NPckJyYW5jaGVkVmFsdWVzKSB7XG4gIHJldHVybiB7cmVzdWx0OiBmYWxzZX07XG59XG5cbi8vIFRha2VzIGFuIG9wZXJhdG9yIG9iamVjdCAoYW4gb2JqZWN0IHdpdGggJCBrZXlzKSBhbmQgcmV0dXJucyBhIGJyYW5jaGVkXG4vLyBtYXRjaGVyIGZvciBpdC5cbmZ1bmN0aW9uIG9wZXJhdG9yQnJhbmNoZWRNYXRjaGVyKHZhbHVlU2VsZWN0b3IsIG1hdGNoZXIsIGlzUm9vdCkge1xuICAvLyBFYWNoIHZhbHVlU2VsZWN0b3Igd29ya3Mgc2VwYXJhdGVseSBvbiB0aGUgdmFyaW91cyBicmFuY2hlcy4gIFNvIG9uZVxuICAvLyBvcGVyYXRvciBjYW4gbWF0Y2ggb25lIGJyYW5jaCBhbmQgYW5vdGhlciBjYW4gbWF0Y2ggYW5vdGhlciBicmFuY2guICBUaGlzXG4gIC8vIGlzIE9LLlxuICBjb25zdCBvcGVyYXRvck1hdGNoZXJzID0gT2JqZWN0LmtleXModmFsdWVTZWxlY3RvcikubWFwKG9wZXJhdG9yID0+IHtcbiAgICBjb25zdCBvcGVyYW5kID0gdmFsdWVTZWxlY3RvcltvcGVyYXRvcl07XG5cbiAgICBjb25zdCBzaW1wbGVSYW5nZSA9IChcbiAgICAgIFsnJGx0JywgJyRsdGUnLCAnJGd0JywgJyRndGUnXS5pbmNsdWRlcyhvcGVyYXRvcikgJiZcbiAgICAgIHR5cGVvZiBvcGVyYW5kID09PSAnbnVtYmVyJ1xuICAgICk7XG5cbiAgICBjb25zdCBzaW1wbGVFcXVhbGl0eSA9IChcbiAgICAgIFsnJG5lJywgJyRlcSddLmluY2x1ZGVzKG9wZXJhdG9yKSAmJlxuICAgICAgb3BlcmFuZCAhPT0gT2JqZWN0KG9wZXJhbmQpXG4gICAgKTtcblxuICAgIGNvbnN0IHNpbXBsZUluY2x1c2lvbiA9IChcbiAgICAgIFsnJGluJywgJyRuaW4nXS5pbmNsdWRlcyhvcGVyYXRvcilcbiAgICAgICYmIEFycmF5LmlzQXJyYXkob3BlcmFuZClcbiAgICAgICYmICFvcGVyYW5kLnNvbWUoeCA9PiB4ID09PSBPYmplY3QoeCkpXG4gICAgKTtcblxuICAgIGlmICghKHNpbXBsZVJhbmdlIHx8IHNpbXBsZUluY2x1c2lvbiB8fCBzaW1wbGVFcXVhbGl0eSkpIHtcbiAgICAgIG1hdGNoZXIuX2lzU2ltcGxlID0gZmFsc2U7XG4gICAgfVxuXG4gICAgaWYgKGhhc093bi5jYWxsKFZBTFVFX09QRVJBVE9SUywgb3BlcmF0b3IpKSB7XG4gICAgICByZXR1cm4gVkFMVUVfT1BFUkFUT1JTW29wZXJhdG9yXShvcGVyYW5kLCB2YWx1ZVNlbGVjdG9yLCBtYXRjaGVyLCBpc1Jvb3QpO1xuICAgIH1cblxuICAgIGlmIChoYXNPd24uY2FsbChFTEVNRU5UX09QRVJBVE9SUywgb3BlcmF0b3IpKSB7XG4gICAgICBjb25zdCBvcHRpb25zID0gRUxFTUVOVF9PUEVSQVRPUlNbb3BlcmF0b3JdO1xuICAgICAgcmV0dXJuIGNvbnZlcnRFbGVtZW50TWF0Y2hlclRvQnJhbmNoZWRNYXRjaGVyKFxuICAgICAgICBvcHRpb25zLmNvbXBpbGVFbGVtZW50U2VsZWN0b3Iob3BlcmFuZCwgdmFsdWVTZWxlY3RvciwgbWF0Y2hlciksXG4gICAgICAgIG9wdGlvbnNcbiAgICAgICk7XG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbnJlY29nbml6ZWQgb3BlcmF0b3I6ICR7b3BlcmF0b3J9YCk7XG4gIH0pO1xuXG4gIHJldHVybiBhbmRCcmFuY2hlZE1hdGNoZXJzKG9wZXJhdG9yTWF0Y2hlcnMpO1xufVxuXG4vLyBwYXRocyAtIEFycmF5OiBsaXN0IG9mIG1vbmdvIHN0eWxlIHBhdGhzXG4vLyBuZXdMZWFmRm4gLSBGdW5jdGlvbjogb2YgZm9ybSBmdW5jdGlvbihwYXRoKSBzaG91bGQgcmV0dXJuIGEgc2NhbGFyIHZhbHVlIHRvXG4vLyAgICAgICAgICAgICAgICAgICAgICAgcHV0IGludG8gbGlzdCBjcmVhdGVkIGZvciB0aGF0IHBhdGhcbi8vIGNvbmZsaWN0Rm4gLSBGdW5jdGlvbjogb2YgZm9ybSBmdW5jdGlvbihub2RlLCBwYXRoLCBmdWxsUGF0aCkgaXMgY2FsbGVkXG4vLyAgICAgICAgICAgICAgICAgICAgICAgIHdoZW4gYnVpbGRpbmcgYSB0cmVlIHBhdGggZm9yICdmdWxsUGF0aCcgbm9kZSBvblxuLy8gICAgICAgICAgICAgICAgICAgICAgICAncGF0aCcgd2FzIGFscmVhZHkgYSBsZWFmIHdpdGggYSB2YWx1ZS4gTXVzdCByZXR1cm4gYVxuLy8gICAgICAgICAgICAgICAgICAgICAgICBjb25mbGljdCByZXNvbHV0aW9uLlxuLy8gaW5pdGlhbCB0cmVlIC0gT3B0aW9uYWwgT2JqZWN0OiBzdGFydGluZyB0cmVlLlxuLy8gQHJldHVybnMgLSBPYmplY3Q6IHRyZWUgcmVwcmVzZW50ZWQgYXMgYSBzZXQgb2YgbmVzdGVkIG9iamVjdHNcbmV4cG9ydCBmdW5jdGlvbiBwYXRoc1RvVHJlZShwYXRocywgbmV3TGVhZkZuLCBjb25mbGljdEZuLCByb290ID0ge30pIHtcbiAgcGF0aHMuZm9yRWFjaChwYXRoID0+IHtcbiAgICBjb25zdCBwYXRoQXJyYXkgPSBwYXRoLnNwbGl0KCcuJyk7XG4gICAgbGV0IHRyZWUgPSByb290O1xuXG4gICAgLy8gdXNlIC5ldmVyeSBqdXN0IGZvciBpdGVyYXRpb24gd2l0aCBicmVha1xuICAgIGNvbnN0IHN1Y2Nlc3MgPSBwYXRoQXJyYXkuc2xpY2UoMCwgLTEpLmV2ZXJ5KChrZXksIGkpID0+IHtcbiAgICAgIGlmICghaGFzT3duLmNhbGwodHJlZSwga2V5KSkge1xuICAgICAgICB0cmVlW2tleV0gPSB7fTtcbiAgICAgIH0gZWxzZSBpZiAodHJlZVtrZXldICE9PSBPYmplY3QodHJlZVtrZXldKSkge1xuICAgICAgICB0cmVlW2tleV0gPSBjb25mbGljdEZuKFxuICAgICAgICAgIHRyZWVba2V5XSxcbiAgICAgICAgICBwYXRoQXJyYXkuc2xpY2UoMCwgaSArIDEpLmpvaW4oJy4nKSxcbiAgICAgICAgICBwYXRoXG4gICAgICAgICk7XG5cbiAgICAgICAgLy8gYnJlYWsgb3V0IG9mIGxvb3AgaWYgd2UgYXJlIGZhaWxpbmcgZm9yIHRoaXMgcGF0aFxuICAgICAgICBpZiAodHJlZVtrZXldICE9PSBPYmplY3QodHJlZVtrZXldKSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICB0cmVlID0gdHJlZVtrZXldO1xuXG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9KTtcblxuICAgIGlmIChzdWNjZXNzKSB7XG4gICAgICBjb25zdCBsYXN0S2V5ID0gcGF0aEFycmF5W3BhdGhBcnJheS5sZW5ndGggLSAxXTtcbiAgICAgIGlmIChoYXNPd24uY2FsbCh0cmVlLCBsYXN0S2V5KSkge1xuICAgICAgICB0cmVlW2xhc3RLZXldID0gY29uZmxpY3RGbih0cmVlW2xhc3RLZXldLCBwYXRoLCBwYXRoKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRyZWVbbGFzdEtleV0gPSBuZXdMZWFmRm4ocGF0aCk7XG4gICAgICB9XG4gICAgfVxuICB9KTtcblxuICByZXR1cm4gcm9vdDtcbn1cblxuLy8gTWFrZXMgc3VyZSB3ZSBnZXQgMiBlbGVtZW50cyBhcnJheSBhbmQgYXNzdW1lIHRoZSBmaXJzdCBvbmUgdG8gYmUgeCBhbmRcbi8vIHRoZSBzZWNvbmQgb25lIHRvIHkgbm8gbWF0dGVyIHdoYXQgdXNlciBwYXNzZXMuXG4vLyBJbiBjYXNlIHVzZXIgcGFzc2VzIHsgbG9uOiB4LCBsYXQ6IHkgfSByZXR1cm5zIFt4LCB5XVxuZnVuY3Rpb24gcG9pbnRUb0FycmF5KHBvaW50KSB7XG4gIHJldHVybiBBcnJheS5pc0FycmF5KHBvaW50KSA/IHBvaW50LnNsaWNlKCkgOiBbcG9pbnQueCwgcG9pbnQueV07XG59XG5cbi8vIENyZWF0aW5nIGEgZG9jdW1lbnQgZnJvbSBhbiB1cHNlcnQgaXMgcXVpdGUgdHJpY2t5LlxuLy8gRS5nLiB0aGlzIHNlbGVjdG9yOiB7XCIkb3JcIjogW3tcImIuZm9vXCI6IHtcIiRhbGxcIjogW1wiYmFyXCJdfX1dfSwgc2hvdWxkIHJlc3VsdFxuLy8gaW46IHtcImIuZm9vXCI6IFwiYmFyXCJ9XG4vLyBCdXQgdGhpcyBzZWxlY3Rvcjoge1wiJG9yXCI6IFt7XCJiXCI6IHtcImZvb1wiOiB7XCIkYWxsXCI6IFtcImJhclwiXX19fV19IHNob3VsZCB0aHJvd1xuLy8gYW4gZXJyb3JcblxuLy8gU29tZSBydWxlcyAoZm91bmQgbWFpbmx5IHdpdGggdHJpYWwgJiBlcnJvciwgc28gdGhlcmUgbWlnaHQgYmUgbW9yZSk6XG4vLyAtIGhhbmRsZSBhbGwgY2hpbGRzIG9mICRhbmQgKG9yIGltcGxpY2l0ICRhbmQpXG4vLyAtIGhhbmRsZSAkb3Igbm9kZXMgd2l0aCBleGFjdGx5IDEgY2hpbGRcbi8vIC0gaWdub3JlICRvciBub2RlcyB3aXRoIG1vcmUgdGhhbiAxIGNoaWxkXG4vLyAtIGlnbm9yZSAkbm9yIGFuZCAkbm90IG5vZGVzXG4vLyAtIHRocm93IHdoZW4gYSB2YWx1ZSBjYW4gbm90IGJlIHNldCB1bmFtYmlndW91c2x5XG4vLyAtIGV2ZXJ5IHZhbHVlIGZvciAkYWxsIHNob3VsZCBiZSBkZWFsdCB3aXRoIGFzIHNlcGFyYXRlICRlcS1zXG4vLyAtIHRocmVhdCBhbGwgY2hpbGRyZW4gb2YgJGFsbCBhcyAkZXEgc2V0dGVycyAoPT4gc2V0IGlmICRhbGwubGVuZ3RoID09PSAxLFxuLy8gICBvdGhlcndpc2UgdGhyb3cgZXJyb3IpXG4vLyAtIHlvdSBjYW4gbm90IG1peCAnJCctcHJlZml4ZWQga2V5cyBhbmQgbm9uLSckJy1wcmVmaXhlZCBrZXlzXG4vLyAtIHlvdSBjYW4gb25seSBoYXZlIGRvdHRlZCBrZXlzIG9uIGEgcm9vdC1sZXZlbFxuLy8gLSB5b3UgY2FuIG5vdCBoYXZlICckJy1wcmVmaXhlZCBrZXlzIG1vcmUgdGhhbiBvbmUtbGV2ZWwgZGVlcCBpbiBhbiBvYmplY3RcblxuLy8gSGFuZGxlcyBvbmUga2V5L3ZhbHVlIHBhaXIgdG8gcHV0IGluIHRoZSBzZWxlY3RvciBkb2N1bWVudFxuZnVuY3Rpb24gcG9wdWxhdGVEb2N1bWVudFdpdGhLZXlWYWx1ZShkb2N1bWVudCwga2V5LCB2YWx1ZSkge1xuICBpZiAodmFsdWUgJiYgT2JqZWN0LmdldFByb3RvdHlwZU9mKHZhbHVlKSA9PT0gT2JqZWN0LnByb3RvdHlwZSkge1xuICAgIHBvcHVsYXRlRG9jdW1lbnRXaXRoT2JqZWN0KGRvY3VtZW50LCBrZXksIHZhbHVlKTtcbiAgfSBlbHNlIGlmICghKHZhbHVlIGluc3RhbmNlb2YgUmVnRXhwKSkge1xuICAgIGluc2VydEludG9Eb2N1bWVudChkb2N1bWVudCwga2V5LCB2YWx1ZSk7XG4gIH1cbn1cblxuLy8gSGFuZGxlcyBhIGtleSwgdmFsdWUgcGFpciB0byBwdXQgaW4gdGhlIHNlbGVjdG9yIGRvY3VtZW50XG4vLyBpZiB0aGUgdmFsdWUgaXMgYW4gb2JqZWN0XG5mdW5jdGlvbiBwb3B1bGF0ZURvY3VtZW50V2l0aE9iamVjdChkb2N1bWVudCwga2V5LCB2YWx1ZSkge1xuICBjb25zdCBrZXlzID0gT2JqZWN0LmtleXModmFsdWUpO1xuICBjb25zdCB1bnByZWZpeGVkS2V5cyA9IGtleXMuZmlsdGVyKG9wID0+IG9wWzBdICE9PSAnJCcpO1xuXG4gIGlmICh1bnByZWZpeGVkS2V5cy5sZW5ndGggPiAwIHx8ICFrZXlzLmxlbmd0aCkge1xuICAgIC8vIExpdGVyYWwgKHBvc3NpYmx5IGVtcHR5KSBvYmplY3QgKCBvciBlbXB0eSBvYmplY3QgKVxuICAgIC8vIERvbid0IGFsbG93IG1peGluZyAnJCctcHJlZml4ZWQgd2l0aCBub24tJyQnLXByZWZpeGVkIGZpZWxkc1xuICAgIGlmIChrZXlzLmxlbmd0aCAhPT0gdW5wcmVmaXhlZEtleXMubGVuZ3RoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHVua25vd24gb3BlcmF0b3I6ICR7dW5wcmVmaXhlZEtleXNbMF19YCk7XG4gICAgfVxuXG4gICAgdmFsaWRhdGVPYmplY3QodmFsdWUsIGtleSk7XG4gICAgaW5zZXJ0SW50b0RvY3VtZW50KGRvY3VtZW50LCBrZXksIHZhbHVlKTtcbiAgfSBlbHNlIHtcbiAgICBPYmplY3Qua2V5cyh2YWx1ZSkuZm9yRWFjaChvcCA9PiB7XG4gICAgICBjb25zdCBvYmplY3QgPSB2YWx1ZVtvcF07XG5cbiAgICAgIGlmIChvcCA9PT0gJyRlcScpIHtcbiAgICAgICAgcG9wdWxhdGVEb2N1bWVudFdpdGhLZXlWYWx1ZShkb2N1bWVudCwga2V5LCBvYmplY3QpO1xuICAgICAgfSBlbHNlIGlmIChvcCA9PT0gJyRhbGwnKSB7XG4gICAgICAgIC8vIGV2ZXJ5IHZhbHVlIGZvciAkYWxsIHNob3VsZCBiZSBkZWFsdCB3aXRoIGFzIHNlcGFyYXRlICRlcS1zXG4gICAgICAgIG9iamVjdC5mb3JFYWNoKGVsZW1lbnQgPT5cbiAgICAgICAgICBwb3B1bGF0ZURvY3VtZW50V2l0aEtleVZhbHVlKGRvY3VtZW50LCBrZXksIGVsZW1lbnQpXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cbn1cblxuLy8gRmlsbHMgYSBkb2N1bWVudCB3aXRoIGNlcnRhaW4gZmllbGRzIGZyb20gYW4gdXBzZXJ0IHNlbGVjdG9yXG5leHBvcnQgZnVuY3Rpb24gcG9wdWxhdGVEb2N1bWVudFdpdGhRdWVyeUZpZWxkcyhxdWVyeSwgZG9jdW1lbnQgPSB7fSkge1xuICBpZiAoT2JqZWN0LmdldFByb3RvdHlwZU9mKHF1ZXJ5KSA9PT0gT2JqZWN0LnByb3RvdHlwZSkge1xuICAgIC8vIGhhbmRsZSBpbXBsaWNpdCAkYW5kXG4gICAgT2JqZWN0LmtleXMocXVlcnkpLmZvckVhY2goa2V5ID0+IHtcbiAgICAgIGNvbnN0IHZhbHVlID0gcXVlcnlba2V5XTtcblxuICAgICAgaWYgKGtleSA9PT0gJyRhbmQnKSB7XG4gICAgICAgIC8vIGhhbmRsZSBleHBsaWNpdCAkYW5kXG4gICAgICAgIHZhbHVlLmZvckVhY2goZWxlbWVudCA9PlxuICAgICAgICAgIHBvcHVsYXRlRG9jdW1lbnRXaXRoUXVlcnlGaWVsZHMoZWxlbWVudCwgZG9jdW1lbnQpXG4gICAgICAgICk7XG4gICAgICB9IGVsc2UgaWYgKGtleSA9PT0gJyRvcicpIHtcbiAgICAgICAgLy8gaGFuZGxlICRvciBub2RlcyB3aXRoIGV4YWN0bHkgMSBjaGlsZFxuICAgICAgICBpZiAodmFsdWUubGVuZ3RoID09PSAxKSB7XG4gICAgICAgICAgcG9wdWxhdGVEb2N1bWVudFdpdGhRdWVyeUZpZWxkcyh2YWx1ZVswXSwgZG9jdW1lbnQpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKGtleVswXSAhPT0gJyQnKSB7XG4gICAgICAgIC8vIElnbm9yZSBvdGhlciAnJCctcHJlZml4ZWQgbG9naWNhbCBzZWxlY3RvcnNcbiAgICAgICAgcG9wdWxhdGVEb2N1bWVudFdpdGhLZXlWYWx1ZShkb2N1bWVudCwga2V5LCB2YWx1ZSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH0gZWxzZSB7XG4gICAgLy8gSGFuZGxlIG1ldGVvci1zcGVjaWZpYyBzaG9ydGN1dCBmb3Igc2VsZWN0aW5nIF9pZFxuICAgIGlmIChMb2NhbENvbGxlY3Rpb24uX3NlbGVjdG9ySXNJZChxdWVyeSkpIHtcbiAgICAgIGluc2VydEludG9Eb2N1bWVudChkb2N1bWVudCwgJ19pZCcsIHF1ZXJ5KTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gZG9jdW1lbnQ7XG59XG5cbi8vIFRyYXZlcnNlcyB0aGUga2V5cyBvZiBwYXNzZWQgcHJvamVjdGlvbiBhbmQgY29uc3RydWN0cyBhIHRyZWUgd2hlcmUgYWxsXG4vLyBsZWF2ZXMgYXJlIGVpdGhlciBhbGwgVHJ1ZSBvciBhbGwgRmFsc2Vcbi8vIEByZXR1cm5zIE9iamVjdDpcbi8vICAtIHRyZWUgLSBPYmplY3QgLSB0cmVlIHJlcHJlc2VudGF0aW9uIG9mIGtleXMgaW52b2x2ZWQgaW4gcHJvamVjdGlvblxuLy8gIChleGNlcHRpb24gZm9yICdfaWQnIGFzIGl0IGlzIGEgc3BlY2lhbCBjYXNlIGhhbmRsZWQgc2VwYXJhdGVseSlcbi8vICAtIGluY2x1ZGluZyAtIEJvb2xlYW4gLSBcInRha2Ugb25seSBjZXJ0YWluIGZpZWxkc1wiIHR5cGUgb2YgcHJvamVjdGlvblxuZXhwb3J0IGZ1bmN0aW9uIHByb2plY3Rpb25EZXRhaWxzKGZpZWxkcykge1xuICAvLyBGaW5kIHRoZSBub24tX2lkIGtleXMgKF9pZCBpcyBoYW5kbGVkIHNwZWNpYWxseSBiZWNhdXNlIGl0IGlzIGluY2x1ZGVkXG4gIC8vIHVubGVzcyBleHBsaWNpdGx5IGV4Y2x1ZGVkKS4gU29ydCB0aGUga2V5cywgc28gdGhhdCBvdXIgY29kZSB0byBkZXRlY3RcbiAgLy8gb3ZlcmxhcHMgbGlrZSAnZm9vJyBhbmQgJ2Zvby5iYXInIGNhbiBhc3N1bWUgdGhhdCAnZm9vJyBjb21lcyBmaXJzdC5cbiAgbGV0IGZpZWxkc0tleXMgPSBPYmplY3Qua2V5cyhmaWVsZHMpLnNvcnQoKTtcblxuICAvLyBJZiBfaWQgaXMgdGhlIG9ubHkgZmllbGQgaW4gdGhlIHByb2plY3Rpb24sIGRvIG5vdCByZW1vdmUgaXQsIHNpbmNlIGl0IGlzXG4gIC8vIHJlcXVpcmVkIHRvIGRldGVybWluZSBpZiB0aGlzIGlzIGFuIGV4Y2x1c2lvbiBvciBleGNsdXNpb24uIEFsc28ga2VlcCBhblxuICAvLyBpbmNsdXNpdmUgX2lkLCBzaW5jZSBpbmNsdXNpdmUgX2lkIGZvbGxvd3MgdGhlIG5vcm1hbCBydWxlcyBhYm91dCBtaXhpbmdcbiAgLy8gaW5jbHVzaXZlIGFuZCBleGNsdXNpdmUgZmllbGRzLiBJZiBfaWQgaXMgbm90IHRoZSBvbmx5IGZpZWxkIGluIHRoZVxuICAvLyBwcm9qZWN0aW9uIGFuZCBpcyBleGNsdXNpdmUsIHJlbW92ZSBpdCBzbyBpdCBjYW4gYmUgaGFuZGxlZCBsYXRlciBieSBhXG4gIC8vIHNwZWNpYWwgY2FzZSwgc2luY2UgZXhjbHVzaXZlIF9pZCBpcyBhbHdheXMgYWxsb3dlZC5cbiAgaWYgKCEoZmllbGRzS2V5cy5sZW5ndGggPT09IDEgJiYgZmllbGRzS2V5c1swXSA9PT0gJ19pZCcpICYmXG4gICAgICAhKGZpZWxkc0tleXMuaW5jbHVkZXMoJ19pZCcpICYmIGZpZWxkcy5faWQpKSB7XG4gICAgZmllbGRzS2V5cyA9IGZpZWxkc0tleXMuZmlsdGVyKGtleSA9PiBrZXkgIT09ICdfaWQnKTtcbiAgfVxuXG4gIGxldCBpbmNsdWRpbmcgPSBudWxsOyAvLyBVbmtub3duXG5cbiAgZmllbGRzS2V5cy5mb3JFYWNoKGtleVBhdGggPT4ge1xuICAgIGNvbnN0IHJ1bGUgPSAhIWZpZWxkc1trZXlQYXRoXTtcblxuICAgIGlmIChpbmNsdWRpbmcgPT09IG51bGwpIHtcbiAgICAgIGluY2x1ZGluZyA9IHJ1bGU7XG4gICAgfVxuXG4gICAgLy8gVGhpcyBlcnJvciBtZXNzYWdlIGlzIGNvcGllZCBmcm9tIE1vbmdvREIgc2hlbGxcbiAgICBpZiAoaW5jbHVkaW5nICE9PSBydWxlKSB7XG4gICAgICB0aHJvdyBNaW5pbW9uZ29FcnJvcihcbiAgICAgICAgJ1lvdSBjYW5ub3QgY3VycmVudGx5IG1peCBpbmNsdWRpbmcgYW5kIGV4Y2x1ZGluZyBmaWVsZHMuJ1xuICAgICAgKTtcbiAgICB9XG4gIH0pO1xuXG4gIGNvbnN0IHByb2plY3Rpb25SdWxlc1RyZWUgPSBwYXRoc1RvVHJlZShcbiAgICBmaWVsZHNLZXlzLFxuICAgIHBhdGggPT4gaW5jbHVkaW5nLFxuICAgIChub2RlLCBwYXRoLCBmdWxsUGF0aCkgPT4ge1xuICAgICAgLy8gQ2hlY2sgcGFzc2VkIHByb2plY3Rpb24gZmllbGRzJyBrZXlzOiBJZiB5b3UgaGF2ZSB0d28gcnVsZXMgc3VjaCBhc1xuICAgICAgLy8gJ2Zvby5iYXInIGFuZCAnZm9vLmJhci5iYXonLCB0aGVuIHRoZSByZXN1bHQgYmVjb21lcyBhbWJpZ3VvdXMuIElmXG4gICAgICAvLyB0aGF0IGhhcHBlbnMsIHRoZXJlIGlzIGEgcHJvYmFiaWxpdHkgeW91IGFyZSBkb2luZyBzb21ldGhpbmcgd3JvbmcsXG4gICAgICAvLyBmcmFtZXdvcmsgc2hvdWxkIG5vdGlmeSB5b3UgYWJvdXQgc3VjaCBtaXN0YWtlIGVhcmxpZXIgb24gY3Vyc29yXG4gICAgICAvLyBjb21waWxhdGlvbiBzdGVwIHRoYW4gbGF0ZXIgZHVyaW5nIHJ1bnRpbWUuICBOb3RlLCB0aGF0IHJlYWwgbW9uZ29cbiAgICAgIC8vIGRvZXNuJ3QgZG8gYW55dGhpbmcgYWJvdXQgaXQgYW5kIHRoZSBsYXRlciBydWxlIGFwcGVhcnMgaW4gcHJvamVjdGlvblxuICAgICAgLy8gcHJvamVjdCwgbW9yZSBwcmlvcml0eSBpdCB0YWtlcy5cbiAgICAgIC8vXG4gICAgICAvLyBFeGFtcGxlLCBhc3N1bWUgZm9sbG93aW5nIGluIG1vbmdvIHNoZWxsOlxuICAgICAgLy8gPiBkYi5jb2xsLmluc2VydCh7IGE6IHsgYjogMjMsIGM6IDQ0IH0gfSlcbiAgICAgIC8vID4gZGIuY29sbC5maW5kKHt9LCB7ICdhJzogMSwgJ2EuYic6IDEgfSlcbiAgICAgIC8vIHtcIl9pZFwiOiBPYmplY3RJZChcIjUyMGJmZTQ1NjAyNDYwOGU4ZWYyNGFmM1wiKSwgXCJhXCI6IHtcImJcIjogMjN9fVxuICAgICAgLy8gPiBkYi5jb2xsLmZpbmQoe30sIHsgJ2EuYic6IDEsICdhJzogMSB9KVxuICAgICAgLy8ge1wiX2lkXCI6IE9iamVjdElkKFwiNTIwYmZlNDU2MDI0NjA4ZThlZjI0YWYzXCIpLCBcImFcIjoge1wiYlwiOiAyMywgXCJjXCI6IDQ0fX1cbiAgICAgIC8vXG4gICAgICAvLyBOb3RlLCBob3cgc2Vjb25kIHRpbWUgdGhlIHJldHVybiBzZXQgb2Yga2V5cyBpcyBkaWZmZXJlbnQuXG4gICAgICBjb25zdCBjdXJyZW50UGF0aCA9IGZ1bGxQYXRoO1xuICAgICAgY29uc3QgYW5vdGhlclBhdGggPSBwYXRoO1xuICAgICAgdGhyb3cgTWluaW1vbmdvRXJyb3IoXG4gICAgICAgIGBib3RoICR7Y3VycmVudFBhdGh9IGFuZCAke2Fub3RoZXJQYXRofSBmb3VuZCBpbiBmaWVsZHMgb3B0aW9uLCBgICtcbiAgICAgICAgJ3VzaW5nIGJvdGggb2YgdGhlbSBtYXkgdHJpZ2dlciB1bmV4cGVjdGVkIGJlaGF2aW9yLiBEaWQgeW91IG1lYW4gdG8gJyArXG4gICAgICAgICd1c2Ugb25seSBvbmUgb2YgdGhlbT8nXG4gICAgICApO1xuICAgIH0pO1xuXG4gIHJldHVybiB7aW5jbHVkaW5nLCB0cmVlOiBwcm9qZWN0aW9uUnVsZXNUcmVlfTtcbn1cblxuLy8gVGFrZXMgYSBSZWdFeHAgb2JqZWN0IGFuZCByZXR1cm5zIGFuIGVsZW1lbnQgbWF0Y2hlci5cbmV4cG9ydCBmdW5jdGlvbiByZWdleHBFbGVtZW50TWF0Y2hlcihyZWdleHApIHtcbiAgcmV0dXJuIHZhbHVlID0+IHtcbiAgICBpZiAodmFsdWUgaW5zdGFuY2VvZiBSZWdFeHApIHtcbiAgICAgIHJldHVybiB2YWx1ZS50b1N0cmluZygpID09PSByZWdleHAudG9TdHJpbmcoKTtcbiAgICB9XG5cbiAgICAvLyBSZWdleHBzIG9ubHkgd29yayBhZ2FpbnN0IHN0cmluZ3MuXG4gICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gJ3N0cmluZycpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICAvLyBSZXNldCByZWdleHAncyBzdGF0ZSB0byBhdm9pZCBpbmNvbnNpc3RlbnQgbWF0Y2hpbmcgZm9yIG9iamVjdHMgd2l0aCB0aGVcbiAgICAvLyBzYW1lIHZhbHVlIG9uIGNvbnNlY3V0aXZlIGNhbGxzIG9mIHJlZ2V4cC50ZXN0LiBUaGlzIGhhcHBlbnMgb25seSBpZiB0aGVcbiAgICAvLyByZWdleHAgaGFzIHRoZSAnZycgZmxhZy4gQWxzbyBub3RlIHRoYXQgRVM2IGludHJvZHVjZXMgYSBuZXcgZmxhZyAneScgZm9yXG4gICAgLy8gd2hpY2ggd2Ugc2hvdWxkICpub3QqIGNoYW5nZSB0aGUgbGFzdEluZGV4IGJ1dCBNb25nb0RCIGRvZXNuJ3Qgc3VwcG9ydFxuICAgIC8vIGVpdGhlciBvZiB0aGVzZSBmbGFncy5cbiAgICByZWdleHAubGFzdEluZGV4ID0gMDtcblxuICAgIHJldHVybiByZWdleHAudGVzdCh2YWx1ZSk7XG4gIH07XG59XG5cbi8vIFZhbGlkYXRlcyB0aGUga2V5IGluIGEgcGF0aC5cbi8vIE9iamVjdHMgdGhhdCBhcmUgbmVzdGVkIG1vcmUgdGhlbiAxIGxldmVsIGNhbm5vdCBoYXZlIGRvdHRlZCBmaWVsZHNcbi8vIG9yIGZpZWxkcyBzdGFydGluZyB3aXRoICckJ1xuZnVuY3Rpb24gdmFsaWRhdGVLZXlJblBhdGgoa2V5LCBwYXRoKSB7XG4gIGlmIChrZXkuaW5jbHVkZXMoJy4nKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIGBUaGUgZG90dGVkIGZpZWxkICcke2tleX0nIGluICcke3BhdGh9LiR7a2V5fSBpcyBub3QgdmFsaWQgZm9yIHN0b3JhZ2UuYFxuICAgICk7XG4gIH1cblxuICBpZiAoa2V5WzBdID09PSAnJCcpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBgVGhlIGRvbGxhciAoJCkgcHJlZml4ZWQgZmllbGQgICcke3BhdGh9LiR7a2V5fSBpcyBub3QgdmFsaWQgZm9yIHN0b3JhZ2UuYFxuICAgICk7XG4gIH1cbn1cblxuLy8gUmVjdXJzaXZlbHkgdmFsaWRhdGVzIGFuIG9iamVjdCB0aGF0IGlzIG5lc3RlZCBtb3JlIHRoYW4gb25lIGxldmVsIGRlZXBcbmZ1bmN0aW9uIHZhbGlkYXRlT2JqZWN0KG9iamVjdCwgcGF0aCkge1xuICBpZiAob2JqZWN0ICYmIE9iamVjdC5nZXRQcm90b3R5cGVPZihvYmplY3QpID09PSBPYmplY3QucHJvdG90eXBlKSB7XG4gICAgT2JqZWN0LmtleXMob2JqZWN0KS5mb3JFYWNoKGtleSA9PiB7XG4gICAgICB2YWxpZGF0ZUtleUluUGF0aChrZXksIHBhdGgpO1xuICAgICAgdmFsaWRhdGVPYmplY3Qob2JqZWN0W2tleV0sIHBhdGggKyAnLicgKyBrZXkpO1xuICAgIH0pO1xuICB9XG59XG4iLCJpbXBvcnQgTG9jYWxDb2xsZWN0aW9uIGZyb20gJy4vbG9jYWxfY29sbGVjdGlvbi5qcyc7XG5pbXBvcnQgeyBoYXNPd24gfSBmcm9tICcuL2NvbW1vbi5qcyc7XG5cbi8vIEN1cnNvcjogYSBzcGVjaWZpY2F0aW9uIGZvciBhIHBhcnRpY3VsYXIgc3Vic2V0IG9mIGRvY3VtZW50cywgdy8gYSBkZWZpbmVkXG4vLyBvcmRlciwgbGltaXQsIGFuZCBvZmZzZXQuICBjcmVhdGluZyBhIEN1cnNvciB3aXRoIExvY2FsQ29sbGVjdGlvbi5maW5kKCksXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBDdXJzb3Ige1xuICAvLyBkb24ndCBjYWxsIHRoaXMgY3RvciBkaXJlY3RseS4gIHVzZSBMb2NhbENvbGxlY3Rpb24uZmluZCgpLlxuICBjb25zdHJ1Y3Rvcihjb2xsZWN0aW9uLCBzZWxlY3Rvciwgb3B0aW9ucyA9IHt9KSB7XG4gICAgdGhpcy5jb2xsZWN0aW9uID0gY29sbGVjdGlvbjtcbiAgICB0aGlzLnNvcnRlciA9IG51bGw7XG4gICAgdGhpcy5tYXRjaGVyID0gbmV3IE1pbmltb25nby5NYXRjaGVyKHNlbGVjdG9yKTtcblxuICAgIGlmIChMb2NhbENvbGxlY3Rpb24uX3NlbGVjdG9ySXNJZFBlcmhhcHNBc09iamVjdChzZWxlY3RvcikpIHtcbiAgICAgIC8vIHN0YXNoIGZvciBmYXN0IF9pZCBhbmQgeyBfaWQgfVxuICAgICAgdGhpcy5fc2VsZWN0b3JJZCA9IGhhc093bi5jYWxsKHNlbGVjdG9yLCAnX2lkJylcbiAgICAgICAgPyBzZWxlY3Rvci5faWRcbiAgICAgICAgOiBzZWxlY3RvcjtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5fc2VsZWN0b3JJZCA9IHVuZGVmaW5lZDtcblxuICAgICAgaWYgKHRoaXMubWF0Y2hlci5oYXNHZW9RdWVyeSgpIHx8IG9wdGlvbnMuc29ydCkge1xuICAgICAgICB0aGlzLnNvcnRlciA9IG5ldyBNaW5pbW9uZ28uU29ydGVyKFxuICAgICAgICAgIG9wdGlvbnMuc29ydCB8fCBbXSxcbiAgICAgICAgICB7bWF0Y2hlcjogdGhpcy5tYXRjaGVyfVxuICAgICAgICApO1xuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuc2tpcCA9IG9wdGlvbnMuc2tpcCB8fCAwO1xuICAgIHRoaXMubGltaXQgPSBvcHRpb25zLmxpbWl0O1xuICAgIHRoaXMuZmllbGRzID0gb3B0aW9ucy5maWVsZHM7XG5cbiAgICB0aGlzLl9wcm9qZWN0aW9uRm4gPSBMb2NhbENvbGxlY3Rpb24uX2NvbXBpbGVQcm9qZWN0aW9uKHRoaXMuZmllbGRzIHx8IHt9KTtcblxuICAgIHRoaXMuX3RyYW5zZm9ybSA9IExvY2FsQ29sbGVjdGlvbi53cmFwVHJhbnNmb3JtKG9wdGlvbnMudHJhbnNmb3JtKTtcblxuICAgIC8vIGJ5IGRlZmF1bHQsIHF1ZXJpZXMgcmVnaXN0ZXIgdy8gVHJhY2tlciB3aGVuIGl0IGlzIGF2YWlsYWJsZS5cbiAgICBpZiAodHlwZW9mIFRyYWNrZXIgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICB0aGlzLnJlYWN0aXZlID0gb3B0aW9ucy5yZWFjdGl2ZSA9PT0gdW5kZWZpbmVkID8gdHJ1ZSA6IG9wdGlvbnMucmVhY3RpdmU7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEBzdW1tYXJ5IFJldHVybnMgdGhlIG51bWJlciBvZiBkb2N1bWVudHMgdGhhdCBtYXRjaCBhIHF1ZXJ5LlxuICAgKiBAbWVtYmVyT2YgTW9uZ28uQ3Vyc29yXG4gICAqIEBtZXRob2QgIGNvdW50XG4gICAqIEBpbnN0YW5jZVxuICAgKiBAbG9jdXMgQW55d2hlcmVcbiAgICogQHJldHVybnMge051bWJlcn1cbiAgICovXG4gIGNvdW50KCkge1xuICAgIGlmICh0aGlzLnJlYWN0aXZlKSB7XG4gICAgICAvLyBhbGxvdyB0aGUgb2JzZXJ2ZSB0byBiZSB1bm9yZGVyZWRcbiAgICAgIHRoaXMuX2RlcGVuZCh7YWRkZWQ6IHRydWUsIHJlbW92ZWQ6IHRydWV9LCB0cnVlKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fZ2V0UmF3T2JqZWN0cyh7b3JkZXJlZDogdHJ1ZX0pLmxlbmd0aDtcbiAgfVxuXG4gIC8qKlxuICAgKiBAc3VtbWFyeSBSZXR1cm4gYWxsIG1hdGNoaW5nIGRvY3VtZW50cyBhcyBhbiBBcnJheS5cbiAgICogQG1lbWJlck9mIE1vbmdvLkN1cnNvclxuICAgKiBAbWV0aG9kICBmZXRjaFxuICAgKiBAaW5zdGFuY2VcbiAgICogQGxvY3VzIEFueXdoZXJlXG4gICAqIEByZXR1cm5zIHtPYmplY3RbXX1cbiAgICovXG4gIGZldGNoKCkge1xuICAgIGNvbnN0IHJlc3VsdCA9IFtdO1xuXG4gICAgdGhpcy5mb3JFYWNoKGRvYyA9PiB7XG4gICAgICByZXN1bHQucHVzaChkb2MpO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIFtTeW1ib2wuaXRlcmF0b3JdKCkge1xuICAgIGlmICh0aGlzLnJlYWN0aXZlKSB7XG4gICAgICB0aGlzLl9kZXBlbmQoe1xuICAgICAgICBhZGRlZEJlZm9yZTogdHJ1ZSxcbiAgICAgICAgcmVtb3ZlZDogdHJ1ZSxcbiAgICAgICAgY2hhbmdlZDogdHJ1ZSxcbiAgICAgICAgbW92ZWRCZWZvcmU6IHRydWV9KTtcbiAgICB9XG5cbiAgICBsZXQgaW5kZXggPSAwO1xuICAgIGNvbnN0IG9iamVjdHMgPSB0aGlzLl9nZXRSYXdPYmplY3RzKHtvcmRlcmVkOiB0cnVlfSk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgbmV4dDogKCkgPT4ge1xuICAgICAgICBpZiAoaW5kZXggPCBvYmplY3RzLmxlbmd0aCkge1xuICAgICAgICAgIC8vIFRoaXMgZG91YmxlcyBhcyBhIGNsb25lIG9wZXJhdGlvbi5cbiAgICAgICAgICBsZXQgZWxlbWVudCA9IHRoaXMuX3Byb2plY3Rpb25GbihvYmplY3RzW2luZGV4KytdKTtcblxuICAgICAgICAgIGlmICh0aGlzLl90cmFuc2Zvcm0pXG4gICAgICAgICAgICBlbGVtZW50ID0gdGhpcy5fdHJhbnNmb3JtKGVsZW1lbnQpO1xuXG4gICAgICAgICAgcmV0dXJuIHt2YWx1ZTogZWxlbWVudH07XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4ge2RvbmU6IHRydWV9O1xuICAgICAgfVxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogQGNhbGxiYWNrIEl0ZXJhdGlvbkNhbGxiYWNrXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBkb2NcbiAgICogQHBhcmFtIHtOdW1iZXJ9IGluZGV4XG4gICAqL1xuICAvKipcbiAgICogQHN1bW1hcnkgQ2FsbCBgY2FsbGJhY2tgIG9uY2UgZm9yIGVhY2ggbWF0Y2hpbmcgZG9jdW1lbnQsIHNlcXVlbnRpYWxseSBhbmRcbiAgICogICAgICAgICAgc3luY2hyb25vdXNseS5cbiAgICogQGxvY3VzIEFueXdoZXJlXG4gICAqIEBtZXRob2QgIGZvckVhY2hcbiAgICogQGluc3RhbmNlXG4gICAqIEBtZW1iZXJPZiBNb25nby5DdXJzb3JcbiAgICogQHBhcmFtIHtJdGVyYXRpb25DYWxsYmFja30gY2FsbGJhY2sgRnVuY3Rpb24gdG8gY2FsbC4gSXQgd2lsbCBiZSBjYWxsZWRcbiAgICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgd2l0aCB0aHJlZSBhcmd1bWVudHM6IHRoZSBkb2N1bWVudCwgYVxuICAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAwLWJhc2VkIGluZGV4LCBhbmQgPGVtPmN1cnNvcjwvZW0+XG4gICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGl0c2VsZi5cbiAgICogQHBhcmFtIHtBbnl9IFt0aGlzQXJnXSBBbiBvYmplY3Qgd2hpY2ggd2lsbCBiZSB0aGUgdmFsdWUgb2YgYHRoaXNgIGluc2lkZVxuICAgKiAgICAgICAgICAgICAgICAgICAgICAgIGBjYWxsYmFja2AuXG4gICAqL1xuICBmb3JFYWNoKGNhbGxiYWNrLCB0aGlzQXJnKSB7XG4gICAgaWYgKHRoaXMucmVhY3RpdmUpIHtcbiAgICAgIHRoaXMuX2RlcGVuZCh7XG4gICAgICAgIGFkZGVkQmVmb3JlOiB0cnVlLFxuICAgICAgICByZW1vdmVkOiB0cnVlLFxuICAgICAgICBjaGFuZ2VkOiB0cnVlLFxuICAgICAgICBtb3ZlZEJlZm9yZTogdHJ1ZX0pO1xuICAgIH1cblxuICAgIHRoaXMuX2dldFJhd09iamVjdHMoe29yZGVyZWQ6IHRydWV9KS5mb3JFYWNoKChlbGVtZW50LCBpKSA9PiB7XG4gICAgICAvLyBUaGlzIGRvdWJsZXMgYXMgYSBjbG9uZSBvcGVyYXRpb24uXG4gICAgICBlbGVtZW50ID0gdGhpcy5fcHJvamVjdGlvbkZuKGVsZW1lbnQpO1xuXG4gICAgICBpZiAodGhpcy5fdHJhbnNmb3JtKSB7XG4gICAgICAgIGVsZW1lbnQgPSB0aGlzLl90cmFuc2Zvcm0oZWxlbWVudCk7XG4gICAgICB9XG5cbiAgICAgIGNhbGxiYWNrLmNhbGwodGhpc0FyZywgZWxlbWVudCwgaSwgdGhpcyk7XG4gICAgfSk7XG4gIH1cblxuICBnZXRUcmFuc2Zvcm0oKSB7XG4gICAgcmV0dXJuIHRoaXMuX3RyYW5zZm9ybTtcbiAgfVxuXG4gIC8qKlxuICAgKiBAc3VtbWFyeSBNYXAgY2FsbGJhY2sgb3ZlciBhbGwgbWF0Y2hpbmcgZG9jdW1lbnRzLiAgUmV0dXJucyBhbiBBcnJheS5cbiAgICogQGxvY3VzIEFueXdoZXJlXG4gICAqIEBtZXRob2QgbWFwXG4gICAqIEBpbnN0YW5jZVxuICAgKiBAbWVtYmVyT2YgTW9uZ28uQ3Vyc29yXG4gICAqIEBwYXJhbSB7SXRlcmF0aW9uQ2FsbGJhY2t9IGNhbGxiYWNrIEZ1bmN0aW9uIHRvIGNhbGwuIEl0IHdpbGwgYmUgY2FsbGVkXG4gICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHdpdGggdGhyZWUgYXJndW1lbnRzOiB0aGUgZG9jdW1lbnQsIGFcbiAgICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgMC1iYXNlZCBpbmRleCwgYW5kIDxlbT5jdXJzb3I8L2VtPlxuICAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpdHNlbGYuXG4gICAqIEBwYXJhbSB7QW55fSBbdGhpc0FyZ10gQW4gb2JqZWN0IHdoaWNoIHdpbGwgYmUgdGhlIHZhbHVlIG9mIGB0aGlzYCBpbnNpZGVcbiAgICogICAgICAgICAgICAgICAgICAgICAgICBgY2FsbGJhY2tgLlxuICAgKi9cbiAgbWFwKGNhbGxiYWNrLCB0aGlzQXJnKSB7XG4gICAgY29uc3QgcmVzdWx0ID0gW107XG5cbiAgICB0aGlzLmZvckVhY2goKGRvYywgaSkgPT4ge1xuICAgICAgcmVzdWx0LnB1c2goY2FsbGJhY2suY2FsbCh0aGlzQXJnLCBkb2MsIGksIHRoaXMpKTtcbiAgICB9KTtcblxuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cblxuICAvLyBvcHRpb25zIHRvIGNvbnRhaW46XG4gIC8vICAqIGNhbGxiYWNrcyBmb3Igb2JzZXJ2ZSgpOlxuICAvLyAgICAtIGFkZGVkQXQgKGRvY3VtZW50LCBhdEluZGV4KVxuICAvLyAgICAtIGFkZGVkIChkb2N1bWVudClcbiAgLy8gICAgLSBjaGFuZ2VkQXQgKG5ld0RvY3VtZW50LCBvbGREb2N1bWVudCwgYXRJbmRleClcbiAgLy8gICAgLSBjaGFuZ2VkIChuZXdEb2N1bWVudCwgb2xkRG9jdW1lbnQpXG4gIC8vICAgIC0gcmVtb3ZlZEF0IChkb2N1bWVudCwgYXRJbmRleClcbiAgLy8gICAgLSByZW1vdmVkIChkb2N1bWVudClcbiAgLy8gICAgLSBtb3ZlZFRvIChkb2N1bWVudCwgb2xkSW5kZXgsIG5ld0luZGV4KVxuICAvL1xuICAvLyBhdHRyaWJ1dGVzIGF2YWlsYWJsZSBvbiByZXR1cm5lZCBxdWVyeSBoYW5kbGU6XG4gIC8vICAqIHN0b3AoKTogZW5kIHVwZGF0ZXNcbiAgLy8gICogY29sbGVjdGlvbjogdGhlIGNvbGxlY3Rpb24gdGhpcyBxdWVyeSBpcyBxdWVyeWluZ1xuICAvL1xuICAvLyBpZmYgeCBpcyBhIHJldHVybmVkIHF1ZXJ5IGhhbmRsZSwgKHggaW5zdGFuY2VvZlxuICAvLyBMb2NhbENvbGxlY3Rpb24uT2JzZXJ2ZUhhbmRsZSkgaXMgdHJ1ZVxuICAvL1xuICAvLyBpbml0aWFsIHJlc3VsdHMgZGVsaXZlcmVkIHRocm91Z2ggYWRkZWQgY2FsbGJhY2tcbiAgLy8gWFhYIG1heWJlIGNhbGxiYWNrcyBzaG91bGQgdGFrZSBhIGxpc3Qgb2Ygb2JqZWN0cywgdG8gZXhwb3NlIHRyYW5zYWN0aW9ucz9cbiAgLy8gWFhYIG1heWJlIHN1cHBvcnQgZmllbGQgbGltaXRpbmcgKHRvIGxpbWl0IHdoYXQgeW91J3JlIG5vdGlmaWVkIG9uKVxuXG4gIC8qKlxuICAgKiBAc3VtbWFyeSBXYXRjaCBhIHF1ZXJ5LiAgUmVjZWl2ZSBjYWxsYmFja3MgYXMgdGhlIHJlc3VsdCBzZXQgY2hhbmdlcy5cbiAgICogQGxvY3VzIEFueXdoZXJlXG4gICAqIEBtZW1iZXJPZiBNb25nby5DdXJzb3JcbiAgICogQGluc3RhbmNlXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBjYWxsYmFja3MgRnVuY3Rpb25zIHRvIGNhbGwgdG8gZGVsaXZlciB0aGUgcmVzdWx0IHNldCBhcyBpdFxuICAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgIGNoYW5nZXNcbiAgICovXG4gIG9ic2VydmUob3B0aW9ucykge1xuICAgIHJldHVybiBMb2NhbENvbGxlY3Rpb24uX29ic2VydmVGcm9tT2JzZXJ2ZUNoYW5nZXModGhpcywgb3B0aW9ucyk7XG4gIH1cblxuICAvKipcbiAgICogQHN1bW1hcnkgV2F0Y2ggYSBxdWVyeS4gUmVjZWl2ZSBjYWxsYmFja3MgYXMgdGhlIHJlc3VsdCBzZXQgY2hhbmdlcy4gT25seVxuICAgKiAgICAgICAgICB0aGUgZGlmZmVyZW5jZXMgYmV0d2VlbiB0aGUgb2xkIGFuZCBuZXcgZG9jdW1lbnRzIGFyZSBwYXNzZWQgdG9cbiAgICogICAgICAgICAgdGhlIGNhbGxiYWNrcy5cbiAgICogQGxvY3VzIEFueXdoZXJlXG4gICAqIEBtZW1iZXJPZiBNb25nby5DdXJzb3JcbiAgICogQGluc3RhbmNlXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBjYWxsYmFja3MgRnVuY3Rpb25zIHRvIGNhbGwgdG8gZGVsaXZlciB0aGUgcmVzdWx0IHNldCBhcyBpdFxuICAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgIGNoYW5nZXNcbiAgICovXG4gIG9ic2VydmVDaGFuZ2VzKG9wdGlvbnMpIHtcbiAgICBjb25zdCBvcmRlcmVkID0gTG9jYWxDb2xsZWN0aW9uLl9vYnNlcnZlQ2hhbmdlc0NhbGxiYWNrc0FyZU9yZGVyZWQob3B0aW9ucyk7XG5cbiAgICAvLyB0aGVyZSBhcmUgc2V2ZXJhbCBwbGFjZXMgdGhhdCBhc3N1bWUgeW91IGFyZW4ndCBjb21iaW5pbmcgc2tpcC9saW1pdCB3aXRoXG4gICAgLy8gdW5vcmRlcmVkIG9ic2VydmUuICBlZywgdXBkYXRlJ3MgRUpTT04uY2xvbmUsIGFuZCB0aGUgXCJ0aGVyZSBhcmUgc2V2ZXJhbFwiXG4gICAgLy8gY29tbWVudCBpbiBfbW9kaWZ5QW5kTm90aWZ5XG4gICAgLy8gWFhYIGFsbG93IHNraXAvbGltaXQgd2l0aCB1bm9yZGVyZWQgb2JzZXJ2ZVxuICAgIGlmICghb3B0aW9ucy5fYWxsb3dfdW5vcmRlcmVkICYmICFvcmRlcmVkICYmICh0aGlzLnNraXAgfHwgdGhpcy5saW1pdCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgJ211c3QgdXNlIG9yZGVyZWQgb2JzZXJ2ZSAoaWUsIFxcJ2FkZGVkQmVmb3JlXFwnIGluc3RlYWQgb2YgXFwnYWRkZWRcXCcpICcgK1xuICAgICAgICAnd2l0aCBza2lwIG9yIGxpbWl0J1xuICAgICAgKTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5maWVsZHMgJiYgKHRoaXMuZmllbGRzLl9pZCA9PT0gMCB8fCB0aGlzLmZpZWxkcy5faWQgPT09IGZhbHNlKSkge1xuICAgICAgdGhyb3cgRXJyb3IoJ1lvdSBtYXkgbm90IG9ic2VydmUgYSBjdXJzb3Igd2l0aCB7ZmllbGRzOiB7X2lkOiAwfX0nKTtcbiAgICB9XG5cbiAgICBjb25zdCBkaXN0YW5jZXMgPSAoXG4gICAgICB0aGlzLm1hdGNoZXIuaGFzR2VvUXVlcnkoKSAmJlxuICAgICAgb3JkZXJlZCAmJlxuICAgICAgbmV3IExvY2FsQ29sbGVjdGlvbi5fSWRNYXBcbiAgICApO1xuXG4gICAgY29uc3QgcXVlcnkgPSB7XG4gICAgICBjdXJzb3I6IHRoaXMsXG4gICAgICBkaXJ0eTogZmFsc2UsXG4gICAgICBkaXN0YW5jZXMsXG4gICAgICBtYXRjaGVyOiB0aGlzLm1hdGNoZXIsIC8vIG5vdCBmYXN0IHBhdGhlZFxuICAgICAgb3JkZXJlZCxcbiAgICAgIHByb2plY3Rpb25GbjogdGhpcy5fcHJvamVjdGlvbkZuLFxuICAgICAgcmVzdWx0c1NuYXBzaG90OiBudWxsLFxuICAgICAgc29ydGVyOiBvcmRlcmVkICYmIHRoaXMuc29ydGVyXG4gICAgfTtcblxuICAgIGxldCBxaWQ7XG5cbiAgICAvLyBOb24tcmVhY3RpdmUgcXVlcmllcyBjYWxsIGFkZGVkW0JlZm9yZV0gYW5kIHRoZW4gbmV2ZXIgY2FsbCBhbnl0aGluZ1xuICAgIC8vIGVsc2UuXG4gICAgaWYgKHRoaXMucmVhY3RpdmUpIHtcbiAgICAgIHFpZCA9IHRoaXMuY29sbGVjdGlvbi5uZXh0X3FpZCsrO1xuICAgICAgdGhpcy5jb2xsZWN0aW9uLnF1ZXJpZXNbcWlkXSA9IHF1ZXJ5O1xuICAgIH1cblxuICAgIHF1ZXJ5LnJlc3VsdHMgPSB0aGlzLl9nZXRSYXdPYmplY3RzKHtvcmRlcmVkLCBkaXN0YW5jZXM6IHF1ZXJ5LmRpc3RhbmNlc30pO1xuXG4gICAgaWYgKHRoaXMuY29sbGVjdGlvbi5wYXVzZWQpIHtcbiAgICAgIHF1ZXJ5LnJlc3VsdHNTbmFwc2hvdCA9IG9yZGVyZWQgPyBbXSA6IG5ldyBMb2NhbENvbGxlY3Rpb24uX0lkTWFwO1xuICAgIH1cblxuICAgIC8vIHdyYXAgY2FsbGJhY2tzIHdlIHdlcmUgcGFzc2VkLiBjYWxsYmFja3Mgb25seSBmaXJlIHdoZW4gbm90IHBhdXNlZCBhbmRcbiAgICAvLyBhcmUgbmV2ZXIgdW5kZWZpbmVkXG4gICAgLy8gRmlsdGVycyBvdXQgYmxhY2tsaXN0ZWQgZmllbGRzIGFjY29yZGluZyB0byBjdXJzb3IncyBwcm9qZWN0aW9uLlxuICAgIC8vIFhYWCB3cm9uZyBwbGFjZSBmb3IgdGhpcz9cblxuICAgIC8vIGZ1cnRoZXJtb3JlLCBjYWxsYmFja3MgZW5xdWV1ZSB1bnRpbCB0aGUgb3BlcmF0aW9uIHdlJ3JlIHdvcmtpbmcgb24gaXNcbiAgICAvLyBkb25lLlxuICAgIGNvbnN0IHdyYXBDYWxsYmFjayA9IGZuID0+IHtcbiAgICAgIGlmICghZm4pIHtcbiAgICAgICAgcmV0dXJuICgpID0+IHt9O1xuICAgICAgfVxuXG4gICAgICBjb25zdCBzZWxmID0gdGhpcztcbiAgICAgIHJldHVybiBmdW5jdGlvbigvKiBhcmdzKi8pIHtcbiAgICAgICAgaWYgKHNlbGYuY29sbGVjdGlvbi5wYXVzZWQpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBhcmdzID0gYXJndW1lbnRzO1xuXG4gICAgICAgIHNlbGYuY29sbGVjdGlvbi5fb2JzZXJ2ZVF1ZXVlLnF1ZXVlVGFzaygoKSA9PiB7XG4gICAgICAgICAgZm4uYXBwbHkodGhpcywgYXJncyk7XG4gICAgICAgIH0pO1xuICAgICAgfTtcbiAgICB9O1xuXG4gICAgcXVlcnkuYWRkZWQgPSB3cmFwQ2FsbGJhY2sob3B0aW9ucy5hZGRlZCk7XG4gICAgcXVlcnkuY2hhbmdlZCA9IHdyYXBDYWxsYmFjayhvcHRpb25zLmNoYW5nZWQpO1xuICAgIHF1ZXJ5LnJlbW92ZWQgPSB3cmFwQ2FsbGJhY2sob3B0aW9ucy5yZW1vdmVkKTtcblxuICAgIGlmIChvcmRlcmVkKSB7XG4gICAgICBxdWVyeS5hZGRlZEJlZm9yZSA9IHdyYXBDYWxsYmFjayhvcHRpb25zLmFkZGVkQmVmb3JlKTtcbiAgICAgIHF1ZXJ5Lm1vdmVkQmVmb3JlID0gd3JhcENhbGxiYWNrKG9wdGlvbnMubW92ZWRCZWZvcmUpO1xuICAgIH1cblxuICAgIGlmICghb3B0aW9ucy5fc3VwcHJlc3NfaW5pdGlhbCAmJiAhdGhpcy5jb2xsZWN0aW9uLnBhdXNlZCkge1xuICAgICAgY29uc3QgcmVzdWx0cyA9IG9yZGVyZWQgPyBxdWVyeS5yZXN1bHRzIDogcXVlcnkucmVzdWx0cy5fbWFwO1xuXG4gICAgICBPYmplY3Qua2V5cyhyZXN1bHRzKS5mb3JFYWNoKGtleSA9PiB7XG4gICAgICAgIGNvbnN0IGRvYyA9IHJlc3VsdHNba2V5XTtcbiAgICAgICAgY29uc3QgZmllbGRzID0gRUpTT04uY2xvbmUoZG9jKTtcblxuICAgICAgICBkZWxldGUgZmllbGRzLl9pZDtcblxuICAgICAgICBpZiAob3JkZXJlZCkge1xuICAgICAgICAgIHF1ZXJ5LmFkZGVkQmVmb3JlKGRvYy5faWQsIHRoaXMuX3Byb2plY3Rpb25GbihmaWVsZHMpLCBudWxsKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHF1ZXJ5LmFkZGVkKGRvYy5faWQsIHRoaXMuX3Byb2plY3Rpb25GbihmaWVsZHMpKTtcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGhhbmRsZSA9IE9iamVjdC5hc3NpZ24obmV3IExvY2FsQ29sbGVjdGlvbi5PYnNlcnZlSGFuZGxlLCB7XG4gICAgICBjb2xsZWN0aW9uOiB0aGlzLmNvbGxlY3Rpb24sXG4gICAgICBzdG9wOiAoKSA9PiB7XG4gICAgICAgIGlmICh0aGlzLnJlYWN0aXZlKSB7XG4gICAgICAgICAgZGVsZXRlIHRoaXMuY29sbGVjdGlvbi5xdWVyaWVzW3FpZF07XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGlmICh0aGlzLnJlYWN0aXZlICYmIFRyYWNrZXIuYWN0aXZlKSB7XG4gICAgICAvLyBYWFggaW4gbWFueSBjYXNlcywgdGhlIHNhbWUgb2JzZXJ2ZSB3aWxsIGJlIHJlY3JlYXRlZCB3aGVuXG4gICAgICAvLyB0aGUgY3VycmVudCBhdXRvcnVuIGlzIHJlcnVuLiAgd2UgY291bGQgc2F2ZSB3b3JrIGJ5XG4gICAgICAvLyBsZXR0aW5nIGl0IGxpbmdlciBhY3Jvc3MgcmVydW4gYW5kIHBvdGVudGlhbGx5IGdldFxuICAgICAgLy8gcmVwdXJwb3NlZCBpZiB0aGUgc2FtZSBvYnNlcnZlIGlzIHBlcmZvcm1lZCwgdXNpbmcgbG9naWNcbiAgICAgIC8vIHNpbWlsYXIgdG8gdGhhdCBvZiBNZXRlb3Iuc3Vic2NyaWJlLlxuICAgICAgVHJhY2tlci5vbkludmFsaWRhdGUoKCkgPT4ge1xuICAgICAgICBoYW5kbGUuc3RvcCgpO1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gcnVuIHRoZSBvYnNlcnZlIGNhbGxiYWNrcyByZXN1bHRpbmcgZnJvbSB0aGUgaW5pdGlhbCBjb250ZW50c1xuICAgIC8vIGJlZm9yZSB3ZSBsZWF2ZSB0aGUgb2JzZXJ2ZS5cbiAgICB0aGlzLmNvbGxlY3Rpb24uX29ic2VydmVRdWV1ZS5kcmFpbigpO1xuXG4gICAgcmV0dXJuIGhhbmRsZTtcbiAgfVxuXG4gIC8vIFNpbmNlIHdlIGRvbid0IGFjdHVhbGx5IGhhdmUgYSBcIm5leHRPYmplY3RcIiBpbnRlcmZhY2UsIHRoZXJlJ3MgcmVhbGx5IG5vXG4gIC8vIHJlYXNvbiB0byBoYXZlIGEgXCJyZXdpbmRcIiBpbnRlcmZhY2UuICBBbGwgaXQgZGlkIHdhcyBtYWtlIG11bHRpcGxlIGNhbGxzXG4gIC8vIHRvIGZldGNoL21hcC9mb3JFYWNoIHJldHVybiBub3RoaW5nIHRoZSBzZWNvbmQgdGltZS5cbiAgLy8gWFhYIENPTVBBVCBXSVRIIDAuOC4xXG4gIHJld2luZCgpIHt9XG5cbiAgLy8gWFhYIE1heWJlIHdlIG5lZWQgYSB2ZXJzaW9uIG9mIG9ic2VydmUgdGhhdCBqdXN0IGNhbGxzIGEgY2FsbGJhY2sgaWZcbiAgLy8gYW55dGhpbmcgY2hhbmdlZC5cbiAgX2RlcGVuZChjaGFuZ2VycywgX2FsbG93X3Vub3JkZXJlZCkge1xuICAgIGlmIChUcmFja2VyLmFjdGl2ZSkge1xuICAgICAgY29uc3QgZGVwZW5kZW5jeSA9IG5ldyBUcmFja2VyLkRlcGVuZGVuY3k7XG4gICAgICBjb25zdCBub3RpZnkgPSBkZXBlbmRlbmN5LmNoYW5nZWQuYmluZChkZXBlbmRlbmN5KTtcblxuICAgICAgZGVwZW5kZW5jeS5kZXBlbmQoKTtcblxuICAgICAgY29uc3Qgb3B0aW9ucyA9IHtfYWxsb3dfdW5vcmRlcmVkLCBfc3VwcHJlc3NfaW5pdGlhbDogdHJ1ZX07XG5cbiAgICAgIFsnYWRkZWQnLCAnYWRkZWRCZWZvcmUnLCAnY2hhbmdlZCcsICdtb3ZlZEJlZm9yZScsICdyZW1vdmVkJ11cbiAgICAgICAgLmZvckVhY2goZm4gPT4ge1xuICAgICAgICAgIGlmIChjaGFuZ2Vyc1tmbl0pIHtcbiAgICAgICAgICAgIG9wdGlvbnNbZm5dID0gbm90aWZ5O1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgIC8vIG9ic2VydmVDaGFuZ2VzIHdpbGwgc3RvcCgpIHdoZW4gdGhpcyBjb21wdXRhdGlvbiBpcyBpbnZhbGlkYXRlZFxuICAgICAgdGhpcy5vYnNlcnZlQ2hhbmdlcyhvcHRpb25zKTtcbiAgICB9XG4gIH1cblxuICBfZ2V0Q29sbGVjdGlvbk5hbWUoKSB7XG4gICAgcmV0dXJuIHRoaXMuY29sbGVjdGlvbi5uYW1lO1xuICB9XG5cbiAgLy8gUmV0dXJucyBhIGNvbGxlY3Rpb24gb2YgbWF0Y2hpbmcgb2JqZWN0cywgYnV0IGRvZXNuJ3QgZGVlcCBjb3B5IHRoZW0uXG4gIC8vXG4gIC8vIElmIG9yZGVyZWQgaXMgc2V0LCByZXR1cm5zIGEgc29ydGVkIGFycmF5LCByZXNwZWN0aW5nIHNvcnRlciwgc2tpcCwgYW5kXG4gIC8vIGxpbWl0IHByb3BlcnRpZXMgb2YgdGhlIHF1ZXJ5LiAgaWYgc29ydGVyIGlzIGZhbHNleSwgbm8gc29ydCAtLSB5b3UgZ2V0IHRoZVxuICAvLyBuYXR1cmFsIG9yZGVyLlxuICAvL1xuICAvLyBJZiBvcmRlcmVkIGlzIG5vdCBzZXQsIHJldHVybnMgYW4gb2JqZWN0IG1hcHBpbmcgZnJvbSBJRCB0byBkb2MgKHNvcnRlcixcbiAgLy8gc2tpcCBhbmQgbGltaXQgc2hvdWxkIG5vdCBiZSBzZXQpLlxuICAvL1xuICAvLyBJZiBvcmRlcmVkIGlzIHNldCBhbmQgdGhpcyBjdXJzb3IgaXMgYSAkbmVhciBnZW9xdWVyeSwgdGhlbiB0aGlzIGZ1bmN0aW9uXG4gIC8vIHdpbGwgdXNlIGFuIF9JZE1hcCB0byB0cmFjayBlYWNoIGRpc3RhbmNlIGZyb20gdGhlICRuZWFyIGFyZ3VtZW50IHBvaW50IGluXG4gIC8vIG9yZGVyIHRvIHVzZSBpdCBhcyBhIHNvcnQga2V5LiBJZiBhbiBfSWRNYXAgaXMgcGFzc2VkIGluIHRoZSAnZGlzdGFuY2VzJ1xuICAvLyBhcmd1bWVudCwgdGhpcyBmdW5jdGlvbiB3aWxsIGNsZWFyIGl0IGFuZCB1c2UgaXQgZm9yIHRoaXMgcHVycG9zZVxuICAvLyAob3RoZXJ3aXNlIGl0IHdpbGwganVzdCBjcmVhdGUgaXRzIG93biBfSWRNYXApLiBUaGUgb2JzZXJ2ZUNoYW5nZXNcbiAgLy8gaW1wbGVtZW50YXRpb24gdXNlcyB0aGlzIHRvIHJlbWVtYmVyIHRoZSBkaXN0YW5jZXMgYWZ0ZXIgdGhpcyBmdW5jdGlvblxuICAvLyByZXR1cm5zLlxuICBfZ2V0UmF3T2JqZWN0cyhvcHRpb25zID0ge30pIHtcbiAgICAvLyBYWFggdXNlIE9yZGVyZWREaWN0IGluc3RlYWQgb2YgYXJyYXksIGFuZCBtYWtlIElkTWFwIGFuZCBPcmRlcmVkRGljdFxuICAgIC8vIGNvbXBhdGlibGVcbiAgICBjb25zdCByZXN1bHRzID0gb3B0aW9ucy5vcmRlcmVkID8gW10gOiBuZXcgTG9jYWxDb2xsZWN0aW9uLl9JZE1hcDtcblxuICAgIC8vIGZhc3QgcGF0aCBmb3Igc2luZ2xlIElEIHZhbHVlXG4gICAgaWYgKHRoaXMuX3NlbGVjdG9ySWQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgLy8gSWYgeW91IGhhdmUgbm9uLXplcm8gc2tpcCBhbmQgYXNrIGZvciBhIHNpbmdsZSBpZCwgeW91IGdldFxuICAgICAgLy8gbm90aGluZy4gVGhpcyBpcyBzbyBpdCBtYXRjaGVzIHRoZSBiZWhhdmlvciBvZiB0aGUgJ3tfaWQ6IGZvb30nXG4gICAgICAvLyBwYXRoLlxuICAgICAgaWYgKHRoaXMuc2tpcCkge1xuICAgICAgICByZXR1cm4gcmVzdWx0cztcbiAgICAgIH1cblxuICAgICAgY29uc3Qgc2VsZWN0ZWREb2MgPSB0aGlzLmNvbGxlY3Rpb24uX2RvY3MuZ2V0KHRoaXMuX3NlbGVjdG9ySWQpO1xuXG4gICAgICBpZiAoc2VsZWN0ZWREb2MpIHtcbiAgICAgICAgaWYgKG9wdGlvbnMub3JkZXJlZCkge1xuICAgICAgICAgIHJlc3VsdHMucHVzaChzZWxlY3RlZERvYyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmVzdWx0cy5zZXQodGhpcy5fc2VsZWN0b3JJZCwgc2VsZWN0ZWREb2MpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHJldHVybiByZXN1bHRzO1xuICAgIH1cblxuICAgIC8vIHNsb3cgcGF0aCBmb3IgYXJiaXRyYXJ5IHNlbGVjdG9yLCBzb3J0LCBza2lwLCBsaW1pdFxuXG4gICAgLy8gaW4gdGhlIG9ic2VydmVDaGFuZ2VzIGNhc2UsIGRpc3RhbmNlcyBpcyBhY3R1YWxseSBwYXJ0IG9mIHRoZSBcInF1ZXJ5XCJcbiAgICAvLyAoaWUsIGxpdmUgcmVzdWx0cyBzZXQpIG9iamVjdC4gIGluIG90aGVyIGNhc2VzLCBkaXN0YW5jZXMgaXMgb25seSB1c2VkXG4gICAgLy8gaW5zaWRlIHRoaXMgZnVuY3Rpb24uXG4gICAgbGV0IGRpc3RhbmNlcztcbiAgICBpZiAodGhpcy5tYXRjaGVyLmhhc0dlb1F1ZXJ5KCkgJiYgb3B0aW9ucy5vcmRlcmVkKSB7XG4gICAgICBpZiAob3B0aW9ucy5kaXN0YW5jZXMpIHtcbiAgICAgICAgZGlzdGFuY2VzID0gb3B0aW9ucy5kaXN0YW5jZXM7XG4gICAgICAgIGRpc3RhbmNlcy5jbGVhcigpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZGlzdGFuY2VzID0gbmV3IExvY2FsQ29sbGVjdGlvbi5fSWRNYXAoKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLmNvbGxlY3Rpb24uX2RvY3MuZm9yRWFjaCgoZG9jLCBpZCkgPT4ge1xuICAgICAgY29uc3QgbWF0Y2hSZXN1bHQgPSB0aGlzLm1hdGNoZXIuZG9jdW1lbnRNYXRjaGVzKGRvYyk7XG5cbiAgICAgIGlmIChtYXRjaFJlc3VsdC5yZXN1bHQpIHtcbiAgICAgICAgaWYgKG9wdGlvbnMub3JkZXJlZCkge1xuICAgICAgICAgIHJlc3VsdHMucHVzaChkb2MpO1xuXG4gICAgICAgICAgaWYgKGRpc3RhbmNlcyAmJiBtYXRjaFJlc3VsdC5kaXN0YW5jZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBkaXN0YW5jZXMuc2V0KGlkLCBtYXRjaFJlc3VsdC5kaXN0YW5jZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJlc3VsdHMuc2V0KGlkLCBkb2MpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIEZhc3QgcGF0aCBmb3IgbGltaXRlZCB1bnNvcnRlZCBxdWVyaWVzLlxuICAgICAgLy8gWFhYICdsZW5ndGgnIGNoZWNrIGhlcmUgc2VlbXMgd3JvbmcgZm9yIG9yZGVyZWRcbiAgICAgIHJldHVybiAoXG4gICAgICAgICF0aGlzLmxpbWl0IHx8XG4gICAgICAgIHRoaXMuc2tpcCB8fFxuICAgICAgICB0aGlzLnNvcnRlciB8fFxuICAgICAgICByZXN1bHRzLmxlbmd0aCAhPT0gdGhpcy5saW1pdFxuICAgICAgKTtcbiAgICB9KTtcblxuICAgIGlmICghb3B0aW9ucy5vcmRlcmVkKSB7XG4gICAgICByZXR1cm4gcmVzdWx0cztcbiAgICB9XG5cbiAgICBpZiAodGhpcy5zb3J0ZXIpIHtcbiAgICAgIHJlc3VsdHMuc29ydCh0aGlzLnNvcnRlci5nZXRDb21wYXJhdG9yKHtkaXN0YW5jZXN9KSk7XG4gICAgfVxuXG4gICAgaWYgKCF0aGlzLmxpbWl0ICYmICF0aGlzLnNraXApIHtcbiAgICAgIHJldHVybiByZXN1bHRzO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRzLnNsaWNlKFxuICAgICAgdGhpcy5za2lwLFxuICAgICAgdGhpcy5saW1pdCA/IHRoaXMubGltaXQgKyB0aGlzLnNraXAgOiByZXN1bHRzLmxlbmd0aFxuICAgICk7XG4gIH1cblxuICBfcHVibGlzaEN1cnNvcihzdWJzY3JpcHRpb24pIHtcbiAgICAvLyBYWFggbWluaW1vbmdvIHNob3VsZCBub3QgZGVwZW5kIG9uIG1vbmdvLWxpdmVkYXRhIVxuICAgIGlmICghUGFja2FnZS5tb25nbykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAnQ2FuXFwndCBwdWJsaXNoIGZyb20gTWluaW1vbmdvIHdpdGhvdXQgdGhlIGBtb25nb2AgcGFja2FnZS4nXG4gICAgICApO1xuICAgIH1cblxuICAgIGlmICghdGhpcy5jb2xsZWN0aW9uLm5hbWUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgJ0NhblxcJ3QgcHVibGlzaCBhIGN1cnNvciBmcm9tIGEgY29sbGVjdGlvbiB3aXRob3V0IGEgbmFtZS4nXG4gICAgICApO1xuICAgIH1cblxuICAgIHJldHVybiBQYWNrYWdlLm1vbmdvLk1vbmdvLkNvbGxlY3Rpb24uX3B1Ymxpc2hDdXJzb3IoXG4gICAgICB0aGlzLFxuICAgICAgc3Vic2NyaXB0aW9uLFxuICAgICAgdGhpcy5jb2xsZWN0aW9uLm5hbWVcbiAgICApO1xuICB9XG59XG4iLCJpbXBvcnQgQ3Vyc29yIGZyb20gJy4vY3Vyc29yLmpzJztcbmltcG9ydCBPYnNlcnZlSGFuZGxlIGZyb20gJy4vb2JzZXJ2ZV9oYW5kbGUuanMnO1xuaW1wb3J0IHtcbiAgaGFzT3duLFxuICBpc0luZGV4YWJsZSxcbiAgaXNOdW1lcmljS2V5LFxuICBpc09wZXJhdG9yT2JqZWN0LFxuICBwb3B1bGF0ZURvY3VtZW50V2l0aFF1ZXJ5RmllbGRzLFxuICBwcm9qZWN0aW9uRGV0YWlscyxcbn0gZnJvbSAnLi9jb21tb24uanMnO1xuXG4vLyBYWFggdHlwZSBjaGVja2luZyBvbiBzZWxlY3RvcnMgKGdyYWNlZnVsIGVycm9yIGlmIG1hbGZvcm1lZClcblxuLy8gTG9jYWxDb2xsZWN0aW9uOiBhIHNldCBvZiBkb2N1bWVudHMgdGhhdCBzdXBwb3J0cyBxdWVyaWVzIGFuZCBtb2RpZmllcnMuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBMb2NhbENvbGxlY3Rpb24ge1xuICBjb25zdHJ1Y3RvcihuYW1lKSB7XG4gICAgdGhpcy5uYW1lID0gbmFtZTtcbiAgICAvLyBfaWQgLT4gZG9jdW1lbnQgKGFsc28gY29udGFpbmluZyBpZClcbiAgICB0aGlzLl9kb2NzID0gbmV3IExvY2FsQ29sbGVjdGlvbi5fSWRNYXA7XG5cbiAgICB0aGlzLl9vYnNlcnZlUXVldWUgPSBuZXcgTWV0ZW9yLl9TeW5jaHJvbm91c1F1ZXVlKCk7XG5cbiAgICB0aGlzLm5leHRfcWlkID0gMTsgLy8gbGl2ZSBxdWVyeSBpZCBnZW5lcmF0b3JcblxuICAgIC8vIHFpZCAtPiBsaXZlIHF1ZXJ5IG9iamVjdC4ga2V5czpcbiAgICAvLyAgb3JkZXJlZDogYm9vbC4gb3JkZXJlZCBxdWVyaWVzIGhhdmUgYWRkZWRCZWZvcmUvbW92ZWRCZWZvcmUgY2FsbGJhY2tzLlxuICAgIC8vICByZXN1bHRzOiBhcnJheSAob3JkZXJlZCkgb3Igb2JqZWN0ICh1bm9yZGVyZWQpIG9mIGN1cnJlbnQgcmVzdWx0c1xuICAgIC8vICAgIChhbGlhc2VkIHdpdGggdGhpcy5fZG9jcyEpXG4gICAgLy8gIHJlc3VsdHNTbmFwc2hvdDogc25hcHNob3Qgb2YgcmVzdWx0cy4gbnVsbCBpZiBub3QgcGF1c2VkLlxuICAgIC8vICBjdXJzb3I6IEN1cnNvciBvYmplY3QgZm9yIHRoZSBxdWVyeS5cbiAgICAvLyAgc2VsZWN0b3IsIHNvcnRlciwgKGNhbGxiYWNrcyk6IGZ1bmN0aW9uc1xuICAgIHRoaXMucXVlcmllcyA9IE9iamVjdC5jcmVhdGUobnVsbCk7XG5cbiAgICAvLyBudWxsIGlmIG5vdCBzYXZpbmcgb3JpZ2luYWxzOyBhbiBJZE1hcCBmcm9tIGlkIHRvIG9yaWdpbmFsIGRvY3VtZW50IHZhbHVlXG4gICAgLy8gaWYgc2F2aW5nIG9yaWdpbmFscy4gU2VlIGNvbW1lbnRzIGJlZm9yZSBzYXZlT3JpZ2luYWxzKCkuXG4gICAgdGhpcy5fc2F2ZWRPcmlnaW5hbHMgPSBudWxsO1xuXG4gICAgLy8gVHJ1ZSB3aGVuIG9ic2VydmVycyBhcmUgcGF1c2VkIGFuZCB3ZSBzaG91bGQgbm90IHNlbmQgY2FsbGJhY2tzLlxuICAgIHRoaXMucGF1c2VkID0gZmFsc2U7XG4gIH1cblxuICAvLyBvcHRpb25zIG1heSBpbmNsdWRlIHNvcnQsIHNraXAsIGxpbWl0LCByZWFjdGl2ZVxuICAvLyBzb3J0IG1heSBiZSBhbnkgb2YgdGhlc2UgZm9ybXM6XG4gIC8vICAgICB7YTogMSwgYjogLTF9XG4gIC8vICAgICBbW1wiYVwiLCBcImFzY1wiXSwgW1wiYlwiLCBcImRlc2NcIl1dXG4gIC8vICAgICBbXCJhXCIsIFtcImJcIiwgXCJkZXNjXCJdXVxuICAvLyAgIChpbiB0aGUgZmlyc3QgZm9ybSB5b3UncmUgYmVob2xkZW4gdG8ga2V5IGVudW1lcmF0aW9uIG9yZGVyIGluXG4gIC8vICAgeW91ciBqYXZhc2NyaXB0IFZNKVxuICAvL1xuICAvLyByZWFjdGl2ZTogaWYgZ2l2ZW4sIGFuZCBmYWxzZSwgZG9uJ3QgcmVnaXN0ZXIgd2l0aCBUcmFja2VyIChkZWZhdWx0XG4gIC8vIGlzIHRydWUpXG4gIC8vXG4gIC8vIFhYWCBwb3NzaWJseSBzaG91bGQgc3VwcG9ydCByZXRyaWV2aW5nIGEgc3Vic2V0IG9mIGZpZWxkcz8gYW5kXG4gIC8vIGhhdmUgaXQgYmUgYSBoaW50IChpZ25vcmVkIG9uIHRoZSBjbGllbnQsIHdoZW4gbm90IGNvcHlpbmcgdGhlXG4gIC8vIGRvYz8pXG4gIC8vXG4gIC8vIFhYWCBzb3J0IGRvZXMgbm90IHlldCBzdXBwb3J0IHN1YmtleXMgKCdhLmInKSAuLiBmaXggdGhhdCFcbiAgLy8gWFhYIGFkZCBvbmUgbW9yZSBzb3J0IGZvcm06IFwia2V5XCJcbiAgLy8gWFhYIHRlc3RzXG4gIGZpbmQoc2VsZWN0b3IsIG9wdGlvbnMpIHtcbiAgICAvLyBkZWZhdWx0IHN5bnRheCBmb3IgZXZlcnl0aGluZyBpcyB0byBvbWl0IHRoZSBzZWxlY3RvciBhcmd1bWVudC5cbiAgICAvLyBidXQgaWYgc2VsZWN0b3IgaXMgZXhwbGljaXRseSBwYXNzZWQgaW4gYXMgZmFsc2Ugb3IgdW5kZWZpbmVkLCB3ZVxuICAgIC8vIHdhbnQgYSBzZWxlY3RvciB0aGF0IG1hdGNoZXMgbm90aGluZy5cbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgc2VsZWN0b3IgPSB7fTtcbiAgICB9XG5cbiAgICByZXR1cm4gbmV3IExvY2FsQ29sbGVjdGlvbi5DdXJzb3IodGhpcywgc2VsZWN0b3IsIG9wdGlvbnMpO1xuICB9XG5cbiAgZmluZE9uZShzZWxlY3Rvciwgb3B0aW9ucyA9IHt9KSB7XG4gICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDApIHtcbiAgICAgIHNlbGVjdG9yID0ge307XG4gICAgfVxuXG4gICAgLy8gTk9URTogYnkgc2V0dGluZyBsaW1pdCAxIGhlcmUsIHdlIGVuZCB1cCB1c2luZyB2ZXJ5IGluZWZmaWNpZW50XG4gICAgLy8gY29kZSB0aGF0IHJlY29tcHV0ZXMgdGhlIHdob2xlIHF1ZXJ5IG9uIGVhY2ggdXBkYXRlLiBUaGUgdXBzaWRlIGlzXG4gICAgLy8gdGhhdCB3aGVuIHlvdSByZWFjdGl2ZWx5IGRlcGVuZCBvbiBhIGZpbmRPbmUgeW91IG9ubHkgZ2V0XG4gICAgLy8gaW52YWxpZGF0ZWQgd2hlbiB0aGUgZm91bmQgb2JqZWN0IGNoYW5nZXMsIG5vdCBhbnkgb2JqZWN0IGluIHRoZVxuICAgIC8vIGNvbGxlY3Rpb24uIE1vc3QgZmluZE9uZSB3aWxsIGJlIGJ5IGlkLCB3aGljaCBoYXMgYSBmYXN0IHBhdGgsIHNvXG4gICAgLy8gdGhpcyBtaWdodCBub3QgYmUgYSBiaWcgZGVhbC4gSW4gbW9zdCBjYXNlcywgaW52YWxpZGF0aW9uIGNhdXNlc1xuICAgIC8vIHRoZSBjYWxsZWQgdG8gcmUtcXVlcnkgYW55d2F5LCBzbyB0aGlzIHNob3VsZCBiZSBhIG5ldCBwZXJmb3JtYW5jZVxuICAgIC8vIGltcHJvdmVtZW50LlxuICAgIG9wdGlvbnMubGltaXQgPSAxO1xuXG4gICAgcmV0dXJuIHRoaXMuZmluZChzZWxlY3Rvciwgb3B0aW9ucykuZmV0Y2goKVswXTtcbiAgfVxuXG4gIC8vIFhYWCBwb3NzaWJseSBlbmZvcmNlIHRoYXQgJ3VuZGVmaW5lZCcgZG9lcyBub3QgYXBwZWFyICh3ZSBhc3N1bWVcbiAgLy8gdGhpcyBpbiBvdXIgaGFuZGxpbmcgb2YgbnVsbCBhbmQgJGV4aXN0cylcbiAgaW5zZXJ0KGRvYywgY2FsbGJhY2spIHtcbiAgICBkb2MgPSBFSlNPTi5jbG9uZShkb2MpO1xuXG4gICAgYXNzZXJ0SGFzVmFsaWRGaWVsZE5hbWVzKGRvYyk7XG5cbiAgICAvLyBpZiB5b3UgcmVhbGx5IHdhbnQgdG8gdXNlIE9iamVjdElEcywgc2V0IHRoaXMgZ2xvYmFsLlxuICAgIC8vIE1vbmdvLkNvbGxlY3Rpb24gc3BlY2lmaWVzIGl0cyBvd24gaWRzIGFuZCBkb2VzIG5vdCB1c2UgdGhpcyBjb2RlLlxuICAgIGlmICghaGFzT3duLmNhbGwoZG9jLCAnX2lkJykpIHtcbiAgICAgIGRvYy5faWQgPSBMb2NhbENvbGxlY3Rpb24uX3VzZU9JRCA/IG5ldyBNb25nb0lELk9iamVjdElEKCkgOiBSYW5kb20uaWQoKTtcbiAgICB9XG5cbiAgICBjb25zdCBpZCA9IGRvYy5faWQ7XG5cbiAgICBpZiAodGhpcy5fZG9jcy5oYXMoaWQpKSB7XG4gICAgICB0aHJvdyBNaW5pbW9uZ29FcnJvcihgRHVwbGljYXRlIF9pZCAnJHtpZH0nYCk7XG4gICAgfVxuXG4gICAgdGhpcy5fc2F2ZU9yaWdpbmFsKGlkLCB1bmRlZmluZWQpO1xuICAgIHRoaXMuX2RvY3Muc2V0KGlkLCBkb2MpO1xuXG4gICAgY29uc3QgcXVlcmllc1RvUmVjb21wdXRlID0gW107XG5cbiAgICAvLyB0cmlnZ2VyIGxpdmUgcXVlcmllcyB0aGF0IG1hdGNoXG4gICAgT2JqZWN0LmtleXModGhpcy5xdWVyaWVzKS5mb3JFYWNoKHFpZCA9PiB7XG4gICAgICBjb25zdCBxdWVyeSA9IHRoaXMucXVlcmllc1txaWRdO1xuXG4gICAgICBpZiAocXVlcnkuZGlydHkpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBtYXRjaFJlc3VsdCA9IHF1ZXJ5Lm1hdGNoZXIuZG9jdW1lbnRNYXRjaGVzKGRvYyk7XG5cbiAgICAgIGlmIChtYXRjaFJlc3VsdC5yZXN1bHQpIHtcbiAgICAgICAgaWYgKHF1ZXJ5LmRpc3RhbmNlcyAmJiBtYXRjaFJlc3VsdC5kaXN0YW5jZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgcXVlcnkuZGlzdGFuY2VzLnNldChpZCwgbWF0Y2hSZXN1bHQuZGlzdGFuY2UpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHF1ZXJ5LmN1cnNvci5za2lwIHx8IHF1ZXJ5LmN1cnNvci5saW1pdCkge1xuICAgICAgICAgIHF1ZXJpZXNUb1JlY29tcHV0ZS5wdXNoKHFpZCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgTG9jYWxDb2xsZWN0aW9uLl9pbnNlcnRJblJlc3VsdHMocXVlcnksIGRvYyk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHF1ZXJpZXNUb1JlY29tcHV0ZS5mb3JFYWNoKHFpZCA9PiB7XG4gICAgICBpZiAodGhpcy5xdWVyaWVzW3FpZF0pIHtcbiAgICAgICAgdGhpcy5fcmVjb21wdXRlUmVzdWx0cyh0aGlzLnF1ZXJpZXNbcWlkXSk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICB0aGlzLl9vYnNlcnZlUXVldWUuZHJhaW4oKTtcblxuICAgIC8vIERlZmVyIGJlY2F1c2UgdGhlIGNhbGxlciBsaWtlbHkgZG9lc24ndCBleHBlY3QgdGhlIGNhbGxiYWNrIHRvIGJlIHJ1blxuICAgIC8vIGltbWVkaWF0ZWx5LlxuICAgIGlmIChjYWxsYmFjaykge1xuICAgICAgTWV0ZW9yLmRlZmVyKCgpID0+IHtcbiAgICAgICAgY2FsbGJhY2sobnVsbCwgaWQpO1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGlkO1xuICB9XG5cbiAgLy8gUGF1c2UgdGhlIG9ic2VydmVycy4gTm8gY2FsbGJhY2tzIGZyb20gb2JzZXJ2ZXJzIHdpbGwgZmlyZSB1bnRpbFxuICAvLyAncmVzdW1lT2JzZXJ2ZXJzJyBpcyBjYWxsZWQuXG4gIHBhdXNlT2JzZXJ2ZXJzKCkge1xuICAgIC8vIE5vLW9wIGlmIGFscmVhZHkgcGF1c2VkLlxuICAgIGlmICh0aGlzLnBhdXNlZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIFNldCB0aGUgJ3BhdXNlZCcgZmxhZyBzdWNoIHRoYXQgbmV3IG9ic2VydmVyIG1lc3NhZ2VzIGRvbid0IGZpcmUuXG4gICAgdGhpcy5wYXVzZWQgPSB0cnVlO1xuXG4gICAgLy8gVGFrZSBhIHNuYXBzaG90IG9mIHRoZSBxdWVyeSByZXN1bHRzIGZvciBlYWNoIHF1ZXJ5LlxuICAgIE9iamVjdC5rZXlzKHRoaXMucXVlcmllcykuZm9yRWFjaChxaWQgPT4ge1xuICAgICAgY29uc3QgcXVlcnkgPSB0aGlzLnF1ZXJpZXNbcWlkXTtcbiAgICAgIHF1ZXJ5LnJlc3VsdHNTbmFwc2hvdCA9IEVKU09OLmNsb25lKHF1ZXJ5LnJlc3VsdHMpO1xuICAgIH0pO1xuICB9XG5cbiAgcmVtb3ZlKHNlbGVjdG9yLCBjYWxsYmFjaykge1xuICAgIC8vIEVhc3kgc3BlY2lhbCBjYXNlOiBpZiB3ZSdyZSBub3QgY2FsbGluZyBvYnNlcnZlQ2hhbmdlcyBjYWxsYmFja3MgYW5kXG4gICAgLy8gd2UncmUgbm90IHNhdmluZyBvcmlnaW5hbHMgYW5kIHdlIGdvdCBhc2tlZCB0byByZW1vdmUgZXZlcnl0aGluZywgdGhlblxuICAgIC8vIGp1c3QgZW1wdHkgZXZlcnl0aGluZyBkaXJlY3RseS5cbiAgICBpZiAodGhpcy5wYXVzZWQgJiYgIXRoaXMuX3NhdmVkT3JpZ2luYWxzICYmIEVKU09OLmVxdWFscyhzZWxlY3Rvciwge30pKSB7XG4gICAgICBjb25zdCByZXN1bHQgPSB0aGlzLl9kb2NzLnNpemUoKTtcblxuICAgICAgdGhpcy5fZG9jcy5jbGVhcigpO1xuXG4gICAgICBPYmplY3Qua2V5cyh0aGlzLnF1ZXJpZXMpLmZvckVhY2gocWlkID0+IHtcbiAgICAgICAgY29uc3QgcXVlcnkgPSB0aGlzLnF1ZXJpZXNbcWlkXTtcblxuICAgICAgICBpZiAocXVlcnkub3JkZXJlZCkge1xuICAgICAgICAgIHF1ZXJ5LnJlc3VsdHMgPSBbXTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBxdWVyeS5yZXN1bHRzLmNsZWFyKCk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgICAgTWV0ZW9yLmRlZmVyKCgpID0+IHtcbiAgICAgICAgICBjYWxsYmFjayhudWxsLCByZXN1bHQpO1xuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG5cbiAgICBjb25zdCBtYXRjaGVyID0gbmV3IE1pbmltb25nby5NYXRjaGVyKHNlbGVjdG9yKTtcbiAgICBjb25zdCByZW1vdmUgPSBbXTtcblxuICAgIHRoaXMuX2VhY2hQb3NzaWJseU1hdGNoaW5nRG9jKHNlbGVjdG9yLCAoZG9jLCBpZCkgPT4ge1xuICAgICAgaWYgKG1hdGNoZXIuZG9jdW1lbnRNYXRjaGVzKGRvYykucmVzdWx0KSB7XG4gICAgICAgIHJlbW92ZS5wdXNoKGlkKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbnN0IHF1ZXJpZXNUb1JlY29tcHV0ZSA9IFtdO1xuICAgIGNvbnN0IHF1ZXJ5UmVtb3ZlID0gW107XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHJlbW92ZS5sZW5ndGg7IGkrKykge1xuICAgICAgY29uc3QgcmVtb3ZlSWQgPSByZW1vdmVbaV07XG4gICAgICBjb25zdCByZW1vdmVEb2MgPSB0aGlzLl9kb2NzLmdldChyZW1vdmVJZCk7XG5cbiAgICAgIE9iamVjdC5rZXlzKHRoaXMucXVlcmllcykuZm9yRWFjaChxaWQgPT4ge1xuICAgICAgICBjb25zdCBxdWVyeSA9IHRoaXMucXVlcmllc1txaWRdO1xuXG4gICAgICAgIGlmIChxdWVyeS5kaXJ0eSkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChxdWVyeS5tYXRjaGVyLmRvY3VtZW50TWF0Y2hlcyhyZW1vdmVEb2MpLnJlc3VsdCkge1xuICAgICAgICAgIGlmIChxdWVyeS5jdXJzb3Iuc2tpcCB8fCBxdWVyeS5jdXJzb3IubGltaXQpIHtcbiAgICAgICAgICAgIHF1ZXJpZXNUb1JlY29tcHV0ZS5wdXNoKHFpZCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHF1ZXJ5UmVtb3ZlLnB1c2goe3FpZCwgZG9jOiByZW1vdmVEb2N9KTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICB0aGlzLl9zYXZlT3JpZ2luYWwocmVtb3ZlSWQsIHJlbW92ZURvYyk7XG4gICAgICB0aGlzLl9kb2NzLnJlbW92ZShyZW1vdmVJZCk7XG4gICAgfVxuXG4gICAgLy8gcnVuIGxpdmUgcXVlcnkgY2FsbGJhY2tzIF9hZnRlcl8gd2UndmUgcmVtb3ZlZCB0aGUgZG9jdW1lbnRzLlxuICAgIHF1ZXJ5UmVtb3ZlLmZvckVhY2gocmVtb3ZlID0+IHtcbiAgICAgIGNvbnN0IHF1ZXJ5ID0gdGhpcy5xdWVyaWVzW3JlbW92ZS5xaWRdO1xuXG4gICAgICBpZiAocXVlcnkpIHtcbiAgICAgICAgcXVlcnkuZGlzdGFuY2VzICYmIHF1ZXJ5LmRpc3RhbmNlcy5yZW1vdmUocmVtb3ZlLmRvYy5faWQpO1xuICAgICAgICBMb2NhbENvbGxlY3Rpb24uX3JlbW92ZUZyb21SZXN1bHRzKHF1ZXJ5LCByZW1vdmUuZG9jKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHF1ZXJpZXNUb1JlY29tcHV0ZS5mb3JFYWNoKHFpZCA9PiB7XG4gICAgICBjb25zdCBxdWVyeSA9IHRoaXMucXVlcmllc1txaWRdO1xuXG4gICAgICBpZiAocXVlcnkpIHtcbiAgICAgICAgdGhpcy5fcmVjb21wdXRlUmVzdWx0cyhxdWVyeSk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICB0aGlzLl9vYnNlcnZlUXVldWUuZHJhaW4oKTtcblxuICAgIGNvbnN0IHJlc3VsdCA9IHJlbW92ZS5sZW5ndGg7XG5cbiAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgIE1ldGVvci5kZWZlcigoKSA9PiB7XG4gICAgICAgIGNhbGxiYWNrKG51bGwsIHJlc3VsdCk7XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgLy8gUmVzdW1lIHRoZSBvYnNlcnZlcnMuIE9ic2VydmVycyBpbW1lZGlhdGVseSByZWNlaXZlIGNoYW5nZVxuICAvLyBub3RpZmljYXRpb25zIHRvIGJyaW5nIHRoZW0gdG8gdGhlIGN1cnJlbnQgc3RhdGUgb2YgdGhlXG4gIC8vIGRhdGFiYXNlLiBOb3RlIHRoYXQgdGhpcyBpcyBub3QganVzdCByZXBsYXlpbmcgYWxsIHRoZSBjaGFuZ2VzIHRoYXRcbiAgLy8gaGFwcGVuZWQgZHVyaW5nIHRoZSBwYXVzZSwgaXQgaXMgYSBzbWFydGVyICdjb2FsZXNjZWQnIGRpZmYuXG4gIHJlc3VtZU9ic2VydmVycygpIHtcbiAgICAvLyBOby1vcCBpZiBub3QgcGF1c2VkLlxuICAgIGlmICghdGhpcy5wYXVzZWQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBVbnNldCB0aGUgJ3BhdXNlZCcgZmxhZy4gTWFrZSBzdXJlIHRvIGRvIHRoaXMgZmlyc3QsIG90aGVyd2lzZVxuICAgIC8vIG9ic2VydmVyIG1ldGhvZHMgd29uJ3QgYWN0dWFsbHkgZmlyZSB3aGVuIHdlIHRyaWdnZXIgdGhlbS5cbiAgICB0aGlzLnBhdXNlZCA9IGZhbHNlO1xuXG4gICAgT2JqZWN0LmtleXModGhpcy5xdWVyaWVzKS5mb3JFYWNoKHFpZCA9PiB7XG4gICAgICBjb25zdCBxdWVyeSA9IHRoaXMucXVlcmllc1txaWRdO1xuXG4gICAgICBpZiAocXVlcnkuZGlydHkpIHtcbiAgICAgICAgcXVlcnkuZGlydHkgPSBmYWxzZTtcblxuICAgICAgICAvLyByZS1jb21wdXRlIHJlc3VsdHMgd2lsbCBwZXJmb3JtIGBMb2NhbENvbGxlY3Rpb24uX2RpZmZRdWVyeUNoYW5nZXNgXG4gICAgICAgIC8vIGF1dG9tYXRpY2FsbHkuXG4gICAgICAgIHRoaXMuX3JlY29tcHV0ZVJlc3VsdHMocXVlcnksIHF1ZXJ5LnJlc3VsdHNTbmFwc2hvdCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBEaWZmIHRoZSBjdXJyZW50IHJlc3VsdHMgYWdhaW5zdCB0aGUgc25hcHNob3QgYW5kIHNlbmQgdG8gb2JzZXJ2ZXJzLlxuICAgICAgICAvLyBwYXNzIHRoZSBxdWVyeSBvYmplY3QgZm9yIGl0cyBvYnNlcnZlciBjYWxsYmFja3MuXG4gICAgICAgIExvY2FsQ29sbGVjdGlvbi5fZGlmZlF1ZXJ5Q2hhbmdlcyhcbiAgICAgICAgICBxdWVyeS5vcmRlcmVkLFxuICAgICAgICAgIHF1ZXJ5LnJlc3VsdHNTbmFwc2hvdCxcbiAgICAgICAgICBxdWVyeS5yZXN1bHRzLFxuICAgICAgICAgIHF1ZXJ5LFxuICAgICAgICAgIHtwcm9qZWN0aW9uRm46IHF1ZXJ5LnByb2plY3Rpb25Gbn1cbiAgICAgICAgKTtcbiAgICAgIH1cblxuICAgICAgcXVlcnkucmVzdWx0c1NuYXBzaG90ID0gbnVsbDtcbiAgICB9KTtcblxuICAgIHRoaXMuX29ic2VydmVRdWV1ZS5kcmFpbigpO1xuICB9XG5cbiAgcmV0cmlldmVPcmlnaW5hbHMoKSB7XG4gICAgaWYgKCF0aGlzLl9zYXZlZE9yaWdpbmFscykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdDYWxsZWQgcmV0cmlldmVPcmlnaW5hbHMgd2l0aG91dCBzYXZlT3JpZ2luYWxzJyk7XG4gICAgfVxuXG4gICAgY29uc3Qgb3JpZ2luYWxzID0gdGhpcy5fc2F2ZWRPcmlnaW5hbHM7XG5cbiAgICB0aGlzLl9zYXZlZE9yaWdpbmFscyA9IG51bGw7XG5cbiAgICByZXR1cm4gb3JpZ2luYWxzO1xuICB9XG5cbiAgLy8gVG8gdHJhY2sgd2hhdCBkb2N1bWVudHMgYXJlIGFmZmVjdGVkIGJ5IGEgcGllY2Ugb2YgY29kZSwgY2FsbFxuICAvLyBzYXZlT3JpZ2luYWxzKCkgYmVmb3JlIGl0IGFuZCByZXRyaWV2ZU9yaWdpbmFscygpIGFmdGVyIGl0LlxuICAvLyByZXRyaWV2ZU9yaWdpbmFscyByZXR1cm5zIGFuIG9iamVjdCB3aG9zZSBrZXlzIGFyZSB0aGUgaWRzIG9mIHRoZSBkb2N1bWVudHNcbiAgLy8gdGhhdCB3ZXJlIGFmZmVjdGVkIHNpbmNlIHRoZSBjYWxsIHRvIHNhdmVPcmlnaW5hbHMoKSwgYW5kIHRoZSB2YWx1ZXMgYXJlXG4gIC8vIGVxdWFsIHRvIHRoZSBkb2N1bWVudCdzIGNvbnRlbnRzIGF0IHRoZSB0aW1lIG9mIHNhdmVPcmlnaW5hbHMuIChJbiB0aGUgY2FzZVxuICAvLyBvZiBhbiBpbnNlcnRlZCBkb2N1bWVudCwgdW5kZWZpbmVkIGlzIHRoZSB2YWx1ZS4pIFlvdSBtdXN0IGFsdGVybmF0ZVxuICAvLyBiZXR3ZWVuIGNhbGxzIHRvIHNhdmVPcmlnaW5hbHMoKSBhbmQgcmV0cmlldmVPcmlnaW5hbHMoKS5cbiAgc2F2ZU9yaWdpbmFscygpIHtcbiAgICBpZiAodGhpcy5fc2F2ZWRPcmlnaW5hbHMpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQ2FsbGVkIHNhdmVPcmlnaW5hbHMgdHdpY2Ugd2l0aG91dCByZXRyaWV2ZU9yaWdpbmFscycpO1xuICAgIH1cblxuICAgIHRoaXMuX3NhdmVkT3JpZ2luYWxzID0gbmV3IExvY2FsQ29sbGVjdGlvbi5fSWRNYXA7XG4gIH1cblxuICAvLyBYWFggYXRvbWljaXR5OiBpZiBtdWx0aSBpcyB0cnVlLCBhbmQgb25lIG1vZGlmaWNhdGlvbiBmYWlscywgZG9cbiAgLy8gd2Ugcm9sbGJhY2sgdGhlIHdob2xlIG9wZXJhdGlvbiwgb3Igd2hhdD9cbiAgdXBkYXRlKHNlbGVjdG9yLCBtb2QsIG9wdGlvbnMsIGNhbGxiYWNrKSB7XG4gICAgaWYgKCEgY2FsbGJhY2sgJiYgb3B0aW9ucyBpbnN0YW5jZW9mIEZ1bmN0aW9uKSB7XG4gICAgICBjYWxsYmFjayA9IG9wdGlvbnM7XG4gICAgICBvcHRpb25zID0gbnVsbDtcbiAgICB9XG5cbiAgICBpZiAoIW9wdGlvbnMpIHtcbiAgICAgIG9wdGlvbnMgPSB7fTtcbiAgICB9XG5cbiAgICBjb25zdCBtYXRjaGVyID0gbmV3IE1pbmltb25nby5NYXRjaGVyKHNlbGVjdG9yLCB0cnVlKTtcblxuICAgIC8vIFNhdmUgdGhlIG9yaWdpbmFsIHJlc3VsdHMgb2YgYW55IHF1ZXJ5IHRoYXQgd2UgbWlnaHQgbmVlZCB0b1xuICAgIC8vIF9yZWNvbXB1dGVSZXN1bHRzIG9uLCBiZWNhdXNlIF9tb2RpZnlBbmROb3RpZnkgd2lsbCBtdXRhdGUgdGhlIG9iamVjdHMgaW5cbiAgICAvLyBpdC4gKFdlIGRvbid0IG5lZWQgdG8gc2F2ZSB0aGUgb3JpZ2luYWwgcmVzdWx0cyBvZiBwYXVzZWQgcXVlcmllcyBiZWNhdXNlXG4gICAgLy8gdGhleSBhbHJlYWR5IGhhdmUgYSByZXN1bHRzU25hcHNob3QgYW5kIHdlIHdvbid0IGJlIGRpZmZpbmcgaW5cbiAgICAvLyBfcmVjb21wdXRlUmVzdWx0cy4pXG4gICAgY29uc3QgcWlkVG9PcmlnaW5hbFJlc3VsdHMgPSB7fTtcblxuICAgIC8vIFdlIHNob3VsZCBvbmx5IGNsb25lIGVhY2ggZG9jdW1lbnQgb25jZSwgZXZlbiBpZiBpdCBhcHBlYXJzIGluIG11bHRpcGxlXG4gICAgLy8gcXVlcmllc1xuICAgIGNvbnN0IGRvY01hcCA9IG5ldyBMb2NhbENvbGxlY3Rpb24uX0lkTWFwO1xuICAgIGNvbnN0IGlkc01hdGNoZWQgPSBMb2NhbENvbGxlY3Rpb24uX2lkc01hdGNoZWRCeVNlbGVjdG9yKHNlbGVjdG9yKTtcblxuICAgIE9iamVjdC5rZXlzKHRoaXMucXVlcmllcykuZm9yRWFjaChxaWQgPT4ge1xuICAgICAgY29uc3QgcXVlcnkgPSB0aGlzLnF1ZXJpZXNbcWlkXTtcblxuICAgICAgaWYgKChxdWVyeS5jdXJzb3Iuc2tpcCB8fCBxdWVyeS5jdXJzb3IubGltaXQpICYmICEgdGhpcy5wYXVzZWQpIHtcbiAgICAgICAgLy8gQ2F0Y2ggdGhlIGNhc2Ugb2YgYSByZWFjdGl2ZSBgY291bnQoKWAgb24gYSBjdXJzb3Igd2l0aCBza2lwXG4gICAgICAgIC8vIG9yIGxpbWl0LCB3aGljaCByZWdpc3RlcnMgYW4gdW5vcmRlcmVkIG9ic2VydmUuIFRoaXMgaXMgYVxuICAgICAgICAvLyBwcmV0dHkgcmFyZSBjYXNlLCBzbyB3ZSBqdXN0IGNsb25lIHRoZSBlbnRpcmUgcmVzdWx0IHNldCB3aXRoXG4gICAgICAgIC8vIG5vIG9wdGltaXphdGlvbnMgZm9yIGRvY3VtZW50cyB0aGF0IGFwcGVhciBpbiB0aGVzZSByZXN1bHRcbiAgICAgICAgLy8gc2V0cyBhbmQgb3RoZXIgcXVlcmllcy5cbiAgICAgICAgaWYgKHF1ZXJ5LnJlc3VsdHMgaW5zdGFuY2VvZiBMb2NhbENvbGxlY3Rpb24uX0lkTWFwKSB7XG4gICAgICAgICAgcWlkVG9PcmlnaW5hbFJlc3VsdHNbcWlkXSA9IHF1ZXJ5LnJlc3VsdHMuY2xvbmUoKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIShxdWVyeS5yZXN1bHRzIGluc3RhbmNlb2YgQXJyYXkpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdBc3NlcnRpb24gZmFpbGVkOiBxdWVyeS5yZXN1bHRzIG5vdCBhbiBhcnJheScpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ2xvbmVzIGEgZG9jdW1lbnQgdG8gYmUgc3RvcmVkIGluIGBxaWRUb09yaWdpbmFsUmVzdWx0c2BcbiAgICAgICAgLy8gYmVjYXVzZSBpdCBtYXkgYmUgbW9kaWZpZWQgYmVmb3JlIHRoZSBuZXcgYW5kIG9sZCByZXN1bHQgc2V0c1xuICAgICAgICAvLyBhcmUgZGlmZmVkLiBCdXQgaWYgd2Uga25vdyBleGFjdGx5IHdoaWNoIGRvY3VtZW50IElEcyB3ZSdyZVxuICAgICAgICAvLyBnb2luZyB0byBtb2RpZnksIHRoZW4gd2Ugb25seSBuZWVkIHRvIGNsb25lIHRob3NlLlxuICAgICAgICBjb25zdCBtZW1vaXplZENsb25lSWZOZWVkZWQgPSBkb2MgPT4ge1xuICAgICAgICAgIGlmIChkb2NNYXAuaGFzKGRvYy5faWQpKSB7XG4gICAgICAgICAgICByZXR1cm4gZG9jTWFwLmdldChkb2MuX2lkKTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjb25zdCBkb2NUb01lbW9pemUgPSAoXG4gICAgICAgICAgICBpZHNNYXRjaGVkICYmXG4gICAgICAgICAgICAhaWRzTWF0Y2hlZC5zb21lKGlkID0+IEVKU09OLmVxdWFscyhpZCwgZG9jLl9pZCkpXG4gICAgICAgICAgKSA/IGRvYyA6IEVKU09OLmNsb25lKGRvYyk7XG5cbiAgICAgICAgICBkb2NNYXAuc2V0KGRvYy5faWQsIGRvY1RvTWVtb2l6ZSk7XG5cbiAgICAgICAgICByZXR1cm4gZG9jVG9NZW1vaXplO1xuICAgICAgICB9O1xuXG4gICAgICAgIHFpZFRvT3JpZ2luYWxSZXN1bHRzW3FpZF0gPSBxdWVyeS5yZXN1bHRzLm1hcChtZW1vaXplZENsb25lSWZOZWVkZWQpO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgcmVjb21wdXRlUWlkcyA9IHt9O1xuXG4gICAgbGV0IHVwZGF0ZUNvdW50ID0gMDtcblxuICAgIHRoaXMuX2VhY2hQb3NzaWJseU1hdGNoaW5nRG9jKHNlbGVjdG9yLCAoZG9jLCBpZCkgPT4ge1xuICAgICAgY29uc3QgcXVlcnlSZXN1bHQgPSBtYXRjaGVyLmRvY3VtZW50TWF0Y2hlcyhkb2MpO1xuXG4gICAgICBpZiAocXVlcnlSZXN1bHQucmVzdWx0KSB7XG4gICAgICAgIC8vIFhYWCBTaG91bGQgd2Ugc2F2ZSB0aGUgb3JpZ2luYWwgZXZlbiBpZiBtb2QgZW5kcyB1cCBiZWluZyBhIG5vLW9wP1xuICAgICAgICB0aGlzLl9zYXZlT3JpZ2luYWwoaWQsIGRvYyk7XG4gICAgICAgIHRoaXMuX21vZGlmeUFuZE5vdGlmeShcbiAgICAgICAgICBkb2MsXG4gICAgICAgICAgbW9kLFxuICAgICAgICAgIHJlY29tcHV0ZVFpZHMsXG4gICAgICAgICAgcXVlcnlSZXN1bHQuYXJyYXlJbmRpY2VzXG4gICAgICAgICk7XG5cbiAgICAgICAgKyt1cGRhdGVDb3VudDtcblxuICAgICAgICBpZiAoIW9wdGlvbnMubXVsdGkpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7IC8vIGJyZWFrXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSk7XG5cbiAgICBPYmplY3Qua2V5cyhyZWNvbXB1dGVRaWRzKS5mb3JFYWNoKHFpZCA9PiB7XG4gICAgICBjb25zdCBxdWVyeSA9IHRoaXMucXVlcmllc1txaWRdO1xuXG4gICAgICBpZiAocXVlcnkpIHtcbiAgICAgICAgdGhpcy5fcmVjb21wdXRlUmVzdWx0cyhxdWVyeSwgcWlkVG9PcmlnaW5hbFJlc3VsdHNbcWlkXSk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICB0aGlzLl9vYnNlcnZlUXVldWUuZHJhaW4oKTtcblxuICAgIC8vIElmIHdlIGFyZSBkb2luZyBhbiB1cHNlcnQsIGFuZCB3ZSBkaWRuJ3QgbW9kaWZ5IGFueSBkb2N1bWVudHMgeWV0LCB0aGVuXG4gICAgLy8gaXQncyB0aW1lIHRvIGRvIGFuIGluc2VydC4gRmlndXJlIG91dCB3aGF0IGRvY3VtZW50IHdlIGFyZSBpbnNlcnRpbmcsIGFuZFxuICAgIC8vIGdlbmVyYXRlIGFuIGlkIGZvciBpdC5cbiAgICBsZXQgaW5zZXJ0ZWRJZDtcbiAgICBpZiAodXBkYXRlQ291bnQgPT09IDAgJiYgb3B0aW9ucy51cHNlcnQpIHtcbiAgICAgIGNvbnN0IGRvYyA9IExvY2FsQ29sbGVjdGlvbi5fY3JlYXRlVXBzZXJ0RG9jdW1lbnQoc2VsZWN0b3IsIG1vZCk7XG4gICAgICBpZiAoISBkb2MuX2lkICYmIG9wdGlvbnMuaW5zZXJ0ZWRJZCkge1xuICAgICAgICBkb2MuX2lkID0gb3B0aW9ucy5pbnNlcnRlZElkO1xuICAgICAgfVxuXG4gICAgICBpbnNlcnRlZElkID0gdGhpcy5pbnNlcnQoZG9jKTtcbiAgICAgIHVwZGF0ZUNvdW50ID0gMTtcbiAgICB9XG5cbiAgICAvLyBSZXR1cm4gdGhlIG51bWJlciBvZiBhZmZlY3RlZCBkb2N1bWVudHMsIG9yIGluIHRoZSB1cHNlcnQgY2FzZSwgYW4gb2JqZWN0XG4gICAgLy8gY29udGFpbmluZyB0aGUgbnVtYmVyIG9mIGFmZmVjdGVkIGRvY3MgYW5kIHRoZSBpZCBvZiB0aGUgZG9jIHRoYXQgd2FzXG4gICAgLy8gaW5zZXJ0ZWQsIGlmIGFueS5cbiAgICBsZXQgcmVzdWx0O1xuICAgIGlmIChvcHRpb25zLl9yZXR1cm5PYmplY3QpIHtcbiAgICAgIHJlc3VsdCA9IHtudW1iZXJBZmZlY3RlZDogdXBkYXRlQ291bnR9O1xuXG4gICAgICBpZiAoaW5zZXJ0ZWRJZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHJlc3VsdC5pbnNlcnRlZElkID0gaW5zZXJ0ZWRJZDtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgcmVzdWx0ID0gdXBkYXRlQ291bnQ7XG4gICAgfVxuXG4gICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICBNZXRlb3IuZGVmZXIoKCkgPT4ge1xuICAgICAgICBjYWxsYmFjayhudWxsLCByZXN1bHQpO1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIC8vIEEgY29udmVuaWVuY2Ugd3JhcHBlciBvbiB1cGRhdGUuIExvY2FsQ29sbGVjdGlvbi51cHNlcnQoc2VsLCBtb2QpIGlzXG4gIC8vIGVxdWl2YWxlbnQgdG8gTG9jYWxDb2xsZWN0aW9uLnVwZGF0ZShzZWwsIG1vZCwge3Vwc2VydDogdHJ1ZSxcbiAgLy8gX3JldHVybk9iamVjdDogdHJ1ZX0pLlxuICB1cHNlcnQoc2VsZWN0b3IsIG1vZCwgb3B0aW9ucywgY2FsbGJhY2spIHtcbiAgICBpZiAoIWNhbGxiYWNrICYmIHR5cGVvZiBvcHRpb25zID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBjYWxsYmFjayA9IG9wdGlvbnM7XG4gICAgICBvcHRpb25zID0ge307XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMudXBkYXRlKFxuICAgICAgc2VsZWN0b3IsXG4gICAgICBtb2QsXG4gICAgICBPYmplY3QuYXNzaWduKHt9LCBvcHRpb25zLCB7dXBzZXJ0OiB0cnVlLCBfcmV0dXJuT2JqZWN0OiB0cnVlfSksXG4gICAgICBjYWxsYmFja1xuICAgICk7XG4gIH1cblxuICAvLyBJdGVyYXRlcyBvdmVyIGEgc3Vic2V0IG9mIGRvY3VtZW50cyB0aGF0IGNvdWxkIG1hdGNoIHNlbGVjdG9yOyBjYWxsc1xuICAvLyBmbihkb2MsIGlkKSBvbiBlYWNoIG9mIHRoZW0uICBTcGVjaWZpY2FsbHksIGlmIHNlbGVjdG9yIHNwZWNpZmllc1xuICAvLyBzcGVjaWZpYyBfaWQncywgaXQgb25seSBsb29rcyBhdCB0aG9zZS4gIGRvYyBpcyAqbm90KiBjbG9uZWQ6IGl0IGlzIHRoZVxuICAvLyBzYW1lIG9iamVjdCB0aGF0IGlzIGluIF9kb2NzLlxuICBfZWFjaFBvc3NpYmx5TWF0Y2hpbmdEb2Moc2VsZWN0b3IsIGZuKSB7XG4gICAgY29uc3Qgc3BlY2lmaWNJZHMgPSBMb2NhbENvbGxlY3Rpb24uX2lkc01hdGNoZWRCeVNlbGVjdG9yKHNlbGVjdG9yKTtcblxuICAgIGlmIChzcGVjaWZpY0lkcykge1xuICAgICAgc3BlY2lmaWNJZHMuc29tZShpZCA9PiB7XG4gICAgICAgIGNvbnN0IGRvYyA9IHRoaXMuX2RvY3MuZ2V0KGlkKTtcblxuICAgICAgICBpZiAoZG9jKSB7XG4gICAgICAgICAgcmV0dXJuIGZuKGRvYywgaWQpID09PSBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuX2RvY3MuZm9yRWFjaChmbik7XG4gICAgfVxuICB9XG5cbiAgX21vZGlmeUFuZE5vdGlmeShkb2MsIG1vZCwgcmVjb21wdXRlUWlkcywgYXJyYXlJbmRpY2VzKSB7XG4gICAgY29uc3QgbWF0Y2hlZF9iZWZvcmUgPSB7fTtcblxuICAgIE9iamVjdC5rZXlzKHRoaXMucXVlcmllcykuZm9yRWFjaChxaWQgPT4ge1xuICAgICAgY29uc3QgcXVlcnkgPSB0aGlzLnF1ZXJpZXNbcWlkXTtcblxuICAgICAgaWYgKHF1ZXJ5LmRpcnR5KSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKHF1ZXJ5Lm9yZGVyZWQpIHtcbiAgICAgICAgbWF0Y2hlZF9iZWZvcmVbcWlkXSA9IHF1ZXJ5Lm1hdGNoZXIuZG9jdW1lbnRNYXRjaGVzKGRvYykucmVzdWx0O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gQmVjYXVzZSB3ZSBkb24ndCBzdXBwb3J0IHNraXAgb3IgbGltaXQgKHlldCkgaW4gdW5vcmRlcmVkIHF1ZXJpZXMsIHdlXG4gICAgICAgIC8vIGNhbiBqdXN0IGRvIGEgZGlyZWN0IGxvb2t1cC5cbiAgICAgICAgbWF0Y2hlZF9iZWZvcmVbcWlkXSA9IHF1ZXJ5LnJlc3VsdHMuaGFzKGRvYy5faWQpO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3Qgb2xkX2RvYyA9IEVKU09OLmNsb25lKGRvYyk7XG5cbiAgICBMb2NhbENvbGxlY3Rpb24uX21vZGlmeShkb2MsIG1vZCwge2FycmF5SW5kaWNlc30pO1xuXG4gICAgT2JqZWN0LmtleXModGhpcy5xdWVyaWVzKS5mb3JFYWNoKHFpZCA9PiB7XG4gICAgICBjb25zdCBxdWVyeSA9IHRoaXMucXVlcmllc1txaWRdO1xuXG4gICAgICBpZiAocXVlcnkuZGlydHkpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBhZnRlck1hdGNoID0gcXVlcnkubWF0Y2hlci5kb2N1bWVudE1hdGNoZXMoZG9jKTtcbiAgICAgIGNvbnN0IGFmdGVyID0gYWZ0ZXJNYXRjaC5yZXN1bHQ7XG4gICAgICBjb25zdCBiZWZvcmUgPSBtYXRjaGVkX2JlZm9yZVtxaWRdO1xuXG4gICAgICBpZiAoYWZ0ZXIgJiYgcXVlcnkuZGlzdGFuY2VzICYmIGFmdGVyTWF0Y2guZGlzdGFuY2UgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBxdWVyeS5kaXN0YW5jZXMuc2V0KGRvYy5faWQsIGFmdGVyTWF0Y2guZGlzdGFuY2UpO1xuICAgICAgfVxuXG4gICAgICBpZiAocXVlcnkuY3Vyc29yLnNraXAgfHwgcXVlcnkuY3Vyc29yLmxpbWl0KSB7XG4gICAgICAgIC8vIFdlIG5lZWQgdG8gcmVjb21wdXRlIGFueSBxdWVyeSB3aGVyZSB0aGUgZG9jIG1heSBoYXZlIGJlZW4gaW4gdGhlXG4gICAgICAgIC8vIGN1cnNvcidzIHdpbmRvdyBlaXRoZXIgYmVmb3JlIG9yIGFmdGVyIHRoZSB1cGRhdGUuIChOb3RlIHRoYXQgaWYgc2tpcFxuICAgICAgICAvLyBvciBsaW1pdCBpcyBzZXQsIFwiYmVmb3JlXCIgYW5kIFwiYWZ0ZXJcIiBiZWluZyB0cnVlIGRvIG5vdCBuZWNlc3NhcmlseVxuICAgICAgICAvLyBtZWFuIHRoYXQgdGhlIGRvY3VtZW50IGlzIGluIHRoZSBjdXJzb3IncyBvdXRwdXQgYWZ0ZXIgc2tpcC9saW1pdCBpc1xuICAgICAgICAvLyBhcHBsaWVkLi4uIGJ1dCBpZiB0aGV5IGFyZSBmYWxzZSwgdGhlbiB0aGUgZG9jdW1lbnQgZGVmaW5pdGVseSBpcyBOT1RcbiAgICAgICAgLy8gaW4gdGhlIG91dHB1dC4gU28gaXQncyBzYWZlIHRvIHNraXAgcmVjb21wdXRlIGlmIG5laXRoZXIgYmVmb3JlIG9yXG4gICAgICAgIC8vIGFmdGVyIGFyZSB0cnVlLilcbiAgICAgICAgaWYgKGJlZm9yZSB8fCBhZnRlcikge1xuICAgICAgICAgIHJlY29tcHV0ZVFpZHNbcWlkXSA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAoYmVmb3JlICYmICFhZnRlcikge1xuICAgICAgICBMb2NhbENvbGxlY3Rpb24uX3JlbW92ZUZyb21SZXN1bHRzKHF1ZXJ5LCBkb2MpO1xuICAgICAgfSBlbHNlIGlmICghYmVmb3JlICYmIGFmdGVyKSB7XG4gICAgICAgIExvY2FsQ29sbGVjdGlvbi5faW5zZXJ0SW5SZXN1bHRzKHF1ZXJ5LCBkb2MpO1xuICAgICAgfSBlbHNlIGlmIChiZWZvcmUgJiYgYWZ0ZXIpIHtcbiAgICAgICAgTG9jYWxDb2xsZWN0aW9uLl91cGRhdGVJblJlc3VsdHMocXVlcnksIGRvYywgb2xkX2RvYyk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICAvLyBSZWNvbXB1dGVzIHRoZSByZXN1bHRzIG9mIGEgcXVlcnkgYW5kIHJ1bnMgb2JzZXJ2ZSBjYWxsYmFja3MgZm9yIHRoZVxuICAvLyBkaWZmZXJlbmNlIGJldHdlZW4gdGhlIHByZXZpb3VzIHJlc3VsdHMgYW5kIHRoZSBjdXJyZW50IHJlc3VsdHMgKHVubGVzc1xuICAvLyBwYXVzZWQpLiBVc2VkIGZvciBza2lwL2xpbWl0IHF1ZXJpZXMuXG4gIC8vXG4gIC8vIFdoZW4gdGhpcyBpcyB1c2VkIGJ5IGluc2VydCBvciByZW1vdmUsIGl0IGNhbiBqdXN0IHVzZSBxdWVyeS5yZXN1bHRzIGZvclxuICAvLyB0aGUgb2xkIHJlc3VsdHMgKGFuZCB0aGVyZSdzIG5vIG5lZWQgdG8gcGFzcyBpbiBvbGRSZXN1bHRzKSwgYmVjYXVzZSB0aGVzZVxuICAvLyBvcGVyYXRpb25zIGRvbid0IG11dGF0ZSB0aGUgZG9jdW1lbnRzIGluIHRoZSBjb2xsZWN0aW9uLiBVcGRhdGUgbmVlZHMgdG9cbiAgLy8gcGFzcyBpbiBhbiBvbGRSZXN1bHRzIHdoaWNoIHdhcyBkZWVwLWNvcGllZCBiZWZvcmUgdGhlIG1vZGlmaWVyIHdhc1xuICAvLyBhcHBsaWVkLlxuICAvL1xuICAvLyBvbGRSZXN1bHRzIGlzIGd1YXJhbnRlZWQgdG8gYmUgaWdub3JlZCBpZiB0aGUgcXVlcnkgaXMgbm90IHBhdXNlZC5cbiAgX3JlY29tcHV0ZVJlc3VsdHMocXVlcnksIG9sZFJlc3VsdHMpIHtcbiAgICBpZiAodGhpcy5wYXVzZWQpIHtcbiAgICAgIC8vIFRoZXJlJ3Mgbm8gcmVhc29uIHRvIHJlY29tcHV0ZSB0aGUgcmVzdWx0cyBub3cgYXMgd2UncmUgc3RpbGwgcGF1c2VkLlxuICAgICAgLy8gQnkgZmxhZ2dpbmcgdGhlIHF1ZXJ5IGFzIFwiZGlydHlcIiwgdGhlIHJlY29tcHV0ZSB3aWxsIGJlIHBlcmZvcm1lZFxuICAgICAgLy8gd2hlbiByZXN1bWVPYnNlcnZlcnMgaXMgY2FsbGVkLlxuICAgICAgcXVlcnkuZGlydHkgPSB0cnVlO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICghdGhpcy5wYXVzZWQgJiYgIW9sZFJlc3VsdHMpIHtcbiAgICAgIG9sZFJlc3VsdHMgPSBxdWVyeS5yZXN1bHRzO1xuICAgIH1cblxuICAgIGlmIChxdWVyeS5kaXN0YW5jZXMpIHtcbiAgICAgIHF1ZXJ5LmRpc3RhbmNlcy5jbGVhcigpO1xuICAgIH1cblxuICAgIHF1ZXJ5LnJlc3VsdHMgPSBxdWVyeS5jdXJzb3IuX2dldFJhd09iamVjdHMoe1xuICAgICAgZGlzdGFuY2VzOiBxdWVyeS5kaXN0YW5jZXMsXG4gICAgICBvcmRlcmVkOiBxdWVyeS5vcmRlcmVkXG4gICAgfSk7XG5cbiAgICBpZiAoIXRoaXMucGF1c2VkKSB7XG4gICAgICBMb2NhbENvbGxlY3Rpb24uX2RpZmZRdWVyeUNoYW5nZXMoXG4gICAgICAgIHF1ZXJ5Lm9yZGVyZWQsXG4gICAgICAgIG9sZFJlc3VsdHMsXG4gICAgICAgIHF1ZXJ5LnJlc3VsdHMsXG4gICAgICAgIHF1ZXJ5LFxuICAgICAgICB7cHJvamVjdGlvbkZuOiBxdWVyeS5wcm9qZWN0aW9uRm59XG4gICAgICApO1xuICAgIH1cbiAgfVxuXG4gIF9zYXZlT3JpZ2luYWwoaWQsIGRvYykge1xuICAgIC8vIEFyZSB3ZSBldmVuIHRyeWluZyB0byBzYXZlIG9yaWdpbmFscz9cbiAgICBpZiAoIXRoaXMuX3NhdmVkT3JpZ2luYWxzKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gSGF2ZSB3ZSBwcmV2aW91c2x5IG11dGF0ZWQgdGhlIG9yaWdpbmFsIChhbmQgc28gJ2RvYycgaXMgbm90IGFjdHVhbGx5XG4gICAgLy8gb3JpZ2luYWwpPyAgKE5vdGUgdGhlICdoYXMnIGNoZWNrIHJhdGhlciB0aGFuIHRydXRoOiB3ZSBzdG9yZSB1bmRlZmluZWRcbiAgICAvLyBoZXJlIGZvciBpbnNlcnRlZCBkb2NzISlcbiAgICBpZiAodGhpcy5fc2F2ZWRPcmlnaW5hbHMuaGFzKGlkKSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRoaXMuX3NhdmVkT3JpZ2luYWxzLnNldChpZCwgRUpTT04uY2xvbmUoZG9jKSk7XG4gIH1cbn1cblxuTG9jYWxDb2xsZWN0aW9uLkN1cnNvciA9IEN1cnNvcjtcblxuTG9jYWxDb2xsZWN0aW9uLk9ic2VydmVIYW5kbGUgPSBPYnNlcnZlSGFuZGxlO1xuXG4vLyBYWFggbWF5YmUgbW92ZSB0aGVzZSBpbnRvIGFub3RoZXIgT2JzZXJ2ZUhlbHBlcnMgcGFja2FnZSBvciBzb21ldGhpbmdcblxuLy8gX0NhY2hpbmdDaGFuZ2VPYnNlcnZlciBpcyBhbiBvYmplY3Qgd2hpY2ggcmVjZWl2ZXMgb2JzZXJ2ZUNoYW5nZXMgY2FsbGJhY2tzXG4vLyBhbmQga2VlcHMgYSBjYWNoZSBvZiB0aGUgY3VycmVudCBjdXJzb3Igc3RhdGUgdXAgdG8gZGF0ZSBpbiB0aGlzLmRvY3MuIFVzZXJzXG4vLyBvZiB0aGlzIGNsYXNzIHNob3VsZCByZWFkIHRoZSBkb2NzIGZpZWxkIGJ1dCBub3QgbW9kaWZ5IGl0LiBZb3Ugc2hvdWxkIHBhc3Ncbi8vIHRoZSBcImFwcGx5Q2hhbmdlXCIgZmllbGQgYXMgdGhlIGNhbGxiYWNrcyB0byB0aGUgdW5kZXJseWluZyBvYnNlcnZlQ2hhbmdlc1xuLy8gY2FsbC4gT3B0aW9uYWxseSwgeW91IGNhbiBzcGVjaWZ5IHlvdXIgb3duIG9ic2VydmVDaGFuZ2VzIGNhbGxiYWNrcyB3aGljaCBhcmVcbi8vIGludm9rZWQgaW1tZWRpYXRlbHkgYmVmb3JlIHRoZSBkb2NzIGZpZWxkIGlzIHVwZGF0ZWQ7IHRoaXMgb2JqZWN0IGlzIG1hZGVcbi8vIGF2YWlsYWJsZSBhcyBgdGhpc2AgdG8gdGhvc2UgY2FsbGJhY2tzLlxuTG9jYWxDb2xsZWN0aW9uLl9DYWNoaW5nQ2hhbmdlT2JzZXJ2ZXIgPSBjbGFzcyBfQ2FjaGluZ0NoYW5nZU9ic2VydmVyIHtcbiAgY29uc3RydWN0b3Iob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3Qgb3JkZXJlZEZyb21DYWxsYmFja3MgPSAoXG4gICAgICBvcHRpb25zLmNhbGxiYWNrcyAmJlxuICAgICAgTG9jYWxDb2xsZWN0aW9uLl9vYnNlcnZlQ2hhbmdlc0NhbGxiYWNrc0FyZU9yZGVyZWQob3B0aW9ucy5jYWxsYmFja3MpXG4gICAgKTtcblxuICAgIGlmIChoYXNPd24uY2FsbChvcHRpb25zLCAnb3JkZXJlZCcpKSB7XG4gICAgICB0aGlzLm9yZGVyZWQgPSBvcHRpb25zLm9yZGVyZWQ7XG5cbiAgICAgIGlmIChvcHRpb25zLmNhbGxiYWNrcyAmJiBvcHRpb25zLm9yZGVyZWQgIT09IG9yZGVyZWRGcm9tQ2FsbGJhY2tzKSB7XG4gICAgICAgIHRocm93IEVycm9yKCdvcmRlcmVkIG9wdGlvbiBkb2VzblxcJ3QgbWF0Y2ggY2FsbGJhY2tzJyk7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChvcHRpb25zLmNhbGxiYWNrcykge1xuICAgICAgdGhpcy5vcmRlcmVkID0gb3JkZXJlZEZyb21DYWxsYmFja3M7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IEVycm9yKCdtdXN0IHByb3ZpZGUgb3JkZXJlZCBvciBjYWxsYmFja3MnKTtcbiAgICB9XG5cbiAgICBjb25zdCBjYWxsYmFja3MgPSBvcHRpb25zLmNhbGxiYWNrcyB8fCB7fTtcblxuICAgIGlmICh0aGlzLm9yZGVyZWQpIHtcbiAgICAgIHRoaXMuZG9jcyA9IG5ldyBPcmRlcmVkRGljdChNb25nb0lELmlkU3RyaW5naWZ5KTtcbiAgICAgIHRoaXMuYXBwbHlDaGFuZ2UgPSB7XG4gICAgICAgIGFkZGVkQmVmb3JlOiAoaWQsIGZpZWxkcywgYmVmb3JlKSA9PiB7XG4gICAgICAgICAgY29uc3QgZG9jID0gRUpTT04uY2xvbmUoZmllbGRzKTtcblxuICAgICAgICAgIGRvYy5faWQgPSBpZDtcblxuICAgICAgICAgIGlmIChjYWxsYmFja3MuYWRkZWRCZWZvcmUpIHtcbiAgICAgICAgICAgIGNhbGxiYWNrcy5hZGRlZEJlZm9yZS5jYWxsKHRoaXMsIGlkLCBmaWVsZHMsIGJlZm9yZSk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gVGhpcyBsaW5lIHRyaWdnZXJzIGlmIHdlIHByb3ZpZGUgYWRkZWQgd2l0aCBtb3ZlZEJlZm9yZS5cbiAgICAgICAgICBpZiAoY2FsbGJhY2tzLmFkZGVkKSB7XG4gICAgICAgICAgICBjYWxsYmFja3MuYWRkZWQuY2FsbCh0aGlzLCBpZCwgZmllbGRzKTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyBYWFggY291bGQgYGJlZm9yZWAgYmUgYSBmYWxzeSBJRD8gIFRlY2huaWNhbGx5XG4gICAgICAgICAgLy8gaWRTdHJpbmdpZnkgc2VlbXMgdG8gYWxsb3cgZm9yIHRoZW0gLS0gdGhvdWdoXG4gICAgICAgICAgLy8gT3JkZXJlZERpY3Qgd29uJ3QgY2FsbCBzdHJpbmdpZnkgb24gYSBmYWxzeSBhcmcuXG4gICAgICAgICAgdGhpcy5kb2NzLnB1dEJlZm9yZShpZCwgZG9jLCBiZWZvcmUgfHwgbnVsbCk7XG4gICAgICAgIH0sXG4gICAgICAgIG1vdmVkQmVmb3JlOiAoaWQsIGJlZm9yZSkgPT4ge1xuICAgICAgICAgIGNvbnN0IGRvYyA9IHRoaXMuZG9jcy5nZXQoaWQpO1xuXG4gICAgICAgICAgaWYgKGNhbGxiYWNrcy5tb3ZlZEJlZm9yZSkge1xuICAgICAgICAgICAgY2FsbGJhY2tzLm1vdmVkQmVmb3JlLmNhbGwodGhpcywgaWQsIGJlZm9yZSk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgdGhpcy5kb2NzLm1vdmVCZWZvcmUoaWQsIGJlZm9yZSB8fCBudWxsKTtcbiAgICAgICAgfSxcbiAgICAgIH07XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuZG9jcyA9IG5ldyBMb2NhbENvbGxlY3Rpb24uX0lkTWFwO1xuICAgICAgdGhpcy5hcHBseUNoYW5nZSA9IHtcbiAgICAgICAgYWRkZWQ6IChpZCwgZmllbGRzKSA9PiB7XG4gICAgICAgICAgY29uc3QgZG9jID0gRUpTT04uY2xvbmUoZmllbGRzKTtcblxuICAgICAgICAgIGlmIChjYWxsYmFja3MuYWRkZWQpIHtcbiAgICAgICAgICAgIGNhbGxiYWNrcy5hZGRlZC5jYWxsKHRoaXMsIGlkLCBmaWVsZHMpO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGRvYy5faWQgPSBpZDtcblxuICAgICAgICAgIHRoaXMuZG9jcy5zZXQoaWQsICBkb2MpO1xuICAgICAgICB9LFxuICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBUaGUgbWV0aG9kcyBpbiBfSWRNYXAgYW5kIE9yZGVyZWREaWN0IHVzZWQgYnkgdGhlc2UgY2FsbGJhY2tzIGFyZVxuICAgIC8vIGlkZW50aWNhbC5cbiAgICB0aGlzLmFwcGx5Q2hhbmdlLmNoYW5nZWQgPSAoaWQsIGZpZWxkcykgPT4ge1xuICAgICAgY29uc3QgZG9jID0gdGhpcy5kb2NzLmdldChpZCk7XG5cbiAgICAgIGlmICghZG9jKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBpZCBmb3IgY2hhbmdlZDogJHtpZH1gKTtcbiAgICAgIH1cblxuICAgICAgaWYgKGNhbGxiYWNrcy5jaGFuZ2VkKSB7XG4gICAgICAgIGNhbGxiYWNrcy5jaGFuZ2VkLmNhbGwodGhpcywgaWQsIEVKU09OLmNsb25lKGZpZWxkcykpO1xuICAgICAgfVxuXG4gICAgICBEaWZmU2VxdWVuY2UuYXBwbHlDaGFuZ2VzKGRvYywgZmllbGRzKTtcbiAgICB9O1xuXG4gICAgdGhpcy5hcHBseUNoYW5nZS5yZW1vdmVkID0gaWQgPT4ge1xuICAgICAgaWYgKGNhbGxiYWNrcy5yZW1vdmVkKSB7XG4gICAgICAgIGNhbGxiYWNrcy5yZW1vdmVkLmNhbGwodGhpcywgaWQpO1xuICAgICAgfVxuXG4gICAgICB0aGlzLmRvY3MucmVtb3ZlKGlkKTtcbiAgICB9O1xuICB9XG59O1xuXG5Mb2NhbENvbGxlY3Rpb24uX0lkTWFwID0gY2xhc3MgX0lkTWFwIGV4dGVuZHMgSWRNYXAge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBzdXBlcihNb25nb0lELmlkU3RyaW5naWZ5LCBNb25nb0lELmlkUGFyc2UpO1xuICB9XG59O1xuXG4vLyBXcmFwIGEgdHJhbnNmb3JtIGZ1bmN0aW9uIHRvIHJldHVybiBvYmplY3RzIHRoYXQgaGF2ZSB0aGUgX2lkIGZpZWxkXG4vLyBvZiB0aGUgdW50cmFuc2Zvcm1lZCBkb2N1bWVudC4gVGhpcyBlbnN1cmVzIHRoYXQgc3Vic3lzdGVtcyBzdWNoIGFzXG4vLyB0aGUgb2JzZXJ2ZS1zZXF1ZW5jZSBwYWNrYWdlIHRoYXQgY2FsbCBgb2JzZXJ2ZWAgY2FuIGtlZXAgdHJhY2sgb2Zcbi8vIHRoZSBkb2N1bWVudHMgaWRlbnRpdGllcy5cbi8vXG4vLyAtIFJlcXVpcmUgdGhhdCBpdCByZXR1cm5zIG9iamVjdHNcbi8vIC0gSWYgdGhlIHJldHVybiB2YWx1ZSBoYXMgYW4gX2lkIGZpZWxkLCB2ZXJpZnkgdGhhdCBpdCBtYXRjaGVzIHRoZVxuLy8gICBvcmlnaW5hbCBfaWQgZmllbGRcbi8vIC0gSWYgdGhlIHJldHVybiB2YWx1ZSBkb2Vzbid0IGhhdmUgYW4gX2lkIGZpZWxkLCBhZGQgaXQgYmFjay5cbkxvY2FsQ29sbGVjdGlvbi53cmFwVHJhbnNmb3JtID0gdHJhbnNmb3JtID0+IHtcbiAgaWYgKCF0cmFuc2Zvcm0pIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIC8vIE5vIG5lZWQgdG8gZG91Ymx5LXdyYXAgdHJhbnNmb3Jtcy5cbiAgaWYgKHRyYW5zZm9ybS5fX3dyYXBwZWRUcmFuc2Zvcm1fXykge1xuICAgIHJldHVybiB0cmFuc2Zvcm07XG4gIH1cblxuICBjb25zdCB3cmFwcGVkID0gZG9jID0+IHtcbiAgICBpZiAoIWhhc093bi5jYWxsKGRvYywgJ19pZCcpKSB7XG4gICAgICAvLyBYWFggZG8gd2UgZXZlciBoYXZlIGEgdHJhbnNmb3JtIG9uIHRoZSBvcGxvZydzIGNvbGxlY3Rpb24/IGJlY2F1c2UgdGhhdFxuICAgICAgLy8gY29sbGVjdGlvbiBoYXMgbm8gX2lkLlxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdjYW4gb25seSB0cmFuc2Zvcm0gZG9jdW1lbnRzIHdpdGggX2lkJyk7XG4gICAgfVxuXG4gICAgY29uc3QgaWQgPSBkb2MuX2lkO1xuXG4gICAgLy8gWFhYIGNvbnNpZGVyIG1ha2luZyB0cmFja2VyIGEgd2VhayBkZXBlbmRlbmN5IGFuZCBjaGVja2luZ1xuICAgIC8vIFBhY2thZ2UudHJhY2tlciBoZXJlXG4gICAgY29uc3QgdHJhbnNmb3JtZWQgPSBUcmFja2VyLm5vbnJlYWN0aXZlKCgpID0+IHRyYW5zZm9ybShkb2MpKTtcblxuICAgIGlmICghTG9jYWxDb2xsZWN0aW9uLl9pc1BsYWluT2JqZWN0KHRyYW5zZm9ybWVkKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCd0cmFuc2Zvcm0gbXVzdCByZXR1cm4gb2JqZWN0Jyk7XG4gICAgfVxuXG4gICAgaWYgKGhhc093bi5jYWxsKHRyYW5zZm9ybWVkLCAnX2lkJykpIHtcbiAgICAgIGlmICghRUpTT04uZXF1YWxzKHRyYW5zZm9ybWVkLl9pZCwgaWQpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcigndHJhbnNmb3JtZWQgZG9jdW1lbnQgY2FuXFwndCBoYXZlIGRpZmZlcmVudCBfaWQnKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgdHJhbnNmb3JtZWQuX2lkID0gaWQ7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRyYW5zZm9ybWVkO1xuICB9O1xuXG4gIHdyYXBwZWQuX193cmFwcGVkVHJhbnNmb3JtX18gPSB0cnVlO1xuXG4gIHJldHVybiB3cmFwcGVkO1xufTtcblxuLy8gWFhYIHRoZSBzb3J0ZWQtcXVlcnkgbG9naWMgYmVsb3cgaXMgbGF1Z2hhYmx5IGluZWZmaWNpZW50LiB3ZSdsbFxuLy8gbmVlZCB0byBjb21lIHVwIHdpdGggYSBiZXR0ZXIgZGF0YXN0cnVjdHVyZSBmb3IgdGhpcy5cbi8vXG4vLyBYWFggdGhlIGxvZ2ljIGZvciBvYnNlcnZpbmcgd2l0aCBhIHNraXAgb3IgYSBsaW1pdCBpcyBldmVuIG1vcmVcbi8vIGxhdWdoYWJseSBpbmVmZmljaWVudC4gd2UgcmVjb21wdXRlIHRoZSB3aG9sZSByZXN1bHRzIGV2ZXJ5IHRpbWUhXG5cbi8vIFRoaXMgYmluYXJ5IHNlYXJjaCBwdXRzIGEgdmFsdWUgYmV0d2VlbiBhbnkgZXF1YWwgdmFsdWVzLCBhbmQgdGhlIGZpcnN0XG4vLyBsZXNzZXIgdmFsdWUuXG5Mb2NhbENvbGxlY3Rpb24uX2JpbmFyeVNlYXJjaCA9IChjbXAsIGFycmF5LCB2YWx1ZSkgPT4ge1xuICBsZXQgZmlyc3QgPSAwO1xuICBsZXQgcmFuZ2UgPSBhcnJheS5sZW5ndGg7XG5cbiAgd2hpbGUgKHJhbmdlID4gMCkge1xuICAgIGNvbnN0IGhhbGZSYW5nZSA9IE1hdGguZmxvb3IocmFuZ2UgLyAyKTtcblxuICAgIGlmIChjbXAodmFsdWUsIGFycmF5W2ZpcnN0ICsgaGFsZlJhbmdlXSkgPj0gMCkge1xuICAgICAgZmlyc3QgKz0gaGFsZlJhbmdlICsgMTtcbiAgICAgIHJhbmdlIC09IGhhbGZSYW5nZSArIDE7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJhbmdlID0gaGFsZlJhbmdlO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBmaXJzdDtcbn07XG5cbkxvY2FsQ29sbGVjdGlvbi5fY2hlY2tTdXBwb3J0ZWRQcm9qZWN0aW9uID0gZmllbGRzID0+IHtcbiAgaWYgKGZpZWxkcyAhPT0gT2JqZWN0KGZpZWxkcykgfHwgQXJyYXkuaXNBcnJheShmaWVsZHMpKSB7XG4gICAgdGhyb3cgTWluaW1vbmdvRXJyb3IoJ2ZpZWxkcyBvcHRpb24gbXVzdCBiZSBhbiBvYmplY3QnKTtcbiAgfVxuXG4gIE9iamVjdC5rZXlzKGZpZWxkcykuZm9yRWFjaChrZXlQYXRoID0+IHtcbiAgICBpZiAoa2V5UGF0aC5zcGxpdCgnLicpLmluY2x1ZGVzKCckJykpIHtcbiAgICAgIHRocm93IE1pbmltb25nb0Vycm9yKFxuICAgICAgICAnTWluaW1vbmdvIGRvZXNuXFwndCBzdXBwb3J0ICQgb3BlcmF0b3IgaW4gcHJvamVjdGlvbnMgeWV0LidcbiAgICAgICk7XG4gICAgfVxuXG4gICAgY29uc3QgdmFsdWUgPSBmaWVsZHNba2V5UGF0aF07XG5cbiAgICBpZiAodHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJlxuICAgICAgICBbJyRlbGVtTWF0Y2gnLCAnJG1ldGEnLCAnJHNsaWNlJ10uc29tZShrZXkgPT5cbiAgICAgICAgICBoYXNPd24uY2FsbCh2YWx1ZSwga2V5KVxuICAgICAgICApKSB7XG4gICAgICB0aHJvdyBNaW5pbW9uZ29FcnJvcihcbiAgICAgICAgJ01pbmltb25nbyBkb2VzblxcJ3Qgc3VwcG9ydCBvcGVyYXRvcnMgaW4gcHJvamVjdGlvbnMgeWV0LidcbiAgICAgICk7XG4gICAgfVxuXG4gICAgaWYgKCFbMSwgMCwgdHJ1ZSwgZmFsc2VdLmluY2x1ZGVzKHZhbHVlKSkge1xuICAgICAgdGhyb3cgTWluaW1vbmdvRXJyb3IoXG4gICAgICAgICdQcm9qZWN0aW9uIHZhbHVlcyBzaG91bGQgYmUgb25lIG9mIDEsIDAsIHRydWUsIG9yIGZhbHNlJ1xuICAgICAgKTtcbiAgICB9XG4gIH0pO1xufTtcblxuLy8gS25vd3MgaG93IHRvIGNvbXBpbGUgYSBmaWVsZHMgcHJvamVjdGlvbiB0byBhIHByZWRpY2F0ZSBmdW5jdGlvbi5cbi8vIEByZXR1cm5zIC0gRnVuY3Rpb246IGEgY2xvc3VyZSB0aGF0IGZpbHRlcnMgb3V0IGFuIG9iamVjdCBhY2NvcmRpbmcgdG8gdGhlXG4vLyAgICAgICAgICAgIGZpZWxkcyBwcm9qZWN0aW9uIHJ1bGVzOlxuLy8gICAgICAgICAgICBAcGFyYW0gb2JqIC0gT2JqZWN0OiBNb25nb0RCLXN0eWxlZCBkb2N1bWVudFxuLy8gICAgICAgICAgICBAcmV0dXJucyAtIE9iamVjdDogYSBkb2N1bWVudCB3aXRoIHRoZSBmaWVsZHMgZmlsdGVyZWQgb3V0XG4vLyAgICAgICAgICAgICAgICAgICAgICAgYWNjb3JkaW5nIHRvIHByb2plY3Rpb24gcnVsZXMuIERvZXNuJ3QgcmV0YWluIHN1YmZpZWxkc1xuLy8gICAgICAgICAgICAgICAgICAgICAgIG9mIHBhc3NlZCBhcmd1bWVudC5cbkxvY2FsQ29sbGVjdGlvbi5fY29tcGlsZVByb2plY3Rpb24gPSBmaWVsZHMgPT4ge1xuICBMb2NhbENvbGxlY3Rpb24uX2NoZWNrU3VwcG9ydGVkUHJvamVjdGlvbihmaWVsZHMpO1xuXG4gIGNvbnN0IF9pZFByb2plY3Rpb24gPSBmaWVsZHMuX2lkID09PSB1bmRlZmluZWQgPyB0cnVlIDogZmllbGRzLl9pZDtcbiAgY29uc3QgZGV0YWlscyA9IHByb2plY3Rpb25EZXRhaWxzKGZpZWxkcyk7XG5cbiAgLy8gcmV0dXJucyB0cmFuc2Zvcm1lZCBkb2MgYWNjb3JkaW5nIHRvIHJ1bGVUcmVlXG4gIGNvbnN0IHRyYW5zZm9ybSA9IChkb2MsIHJ1bGVUcmVlKSA9PiB7XG4gICAgLy8gU3BlY2lhbCBjYXNlIGZvciBcInNldHNcIlxuICAgIGlmIChBcnJheS5pc0FycmF5KGRvYykpIHtcbiAgICAgIHJldHVybiBkb2MubWFwKHN1YmRvYyA9PiB0cmFuc2Zvcm0oc3ViZG9jLCBydWxlVHJlZSkpO1xuICAgIH1cblxuICAgIGNvbnN0IHJlc3VsdCA9IGRldGFpbHMuaW5jbHVkaW5nID8ge30gOiBFSlNPTi5jbG9uZShkb2MpO1xuXG4gICAgT2JqZWN0LmtleXMocnVsZVRyZWUpLmZvckVhY2goa2V5ID0+IHtcbiAgICAgIGlmICghaGFzT3duLmNhbGwoZG9jLCBrZXkpKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgY29uc3QgcnVsZSA9IHJ1bGVUcmVlW2tleV07XG5cbiAgICAgIGlmIChydWxlID09PSBPYmplY3QocnVsZSkpIHtcbiAgICAgICAgLy8gRm9yIHN1Yi1vYmplY3RzL3N1YnNldHMgd2UgYnJhbmNoXG4gICAgICAgIGlmIChkb2Nba2V5XSA9PT0gT2JqZWN0KGRvY1trZXldKSkge1xuICAgICAgICAgIHJlc3VsdFtrZXldID0gdHJhbnNmb3JtKGRvY1trZXldLCBydWxlKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmIChkZXRhaWxzLmluY2x1ZGluZykge1xuICAgICAgICAvLyBPdGhlcndpc2Ugd2UgZG9uJ3QgZXZlbiB0b3VjaCB0aGlzIHN1YmZpZWxkXG4gICAgICAgIHJlc3VsdFtrZXldID0gRUpTT04uY2xvbmUoZG9jW2tleV0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZGVsZXRlIHJlc3VsdFtrZXldO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfTtcblxuICByZXR1cm4gZG9jID0+IHtcbiAgICBjb25zdCByZXN1bHQgPSB0cmFuc2Zvcm0oZG9jLCBkZXRhaWxzLnRyZWUpO1xuXG4gICAgaWYgKF9pZFByb2plY3Rpb24gJiYgaGFzT3duLmNhbGwoZG9jLCAnX2lkJykpIHtcbiAgICAgIHJlc3VsdC5faWQgPSBkb2MuX2lkO1xuICAgIH1cblxuICAgIGlmICghX2lkUHJvamVjdGlvbiAmJiBoYXNPd24uY2FsbChyZXN1bHQsICdfaWQnKSkge1xuICAgICAgZGVsZXRlIHJlc3VsdC5faWQ7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfTtcbn07XG5cbi8vIENhbGN1bGF0ZXMgdGhlIGRvY3VtZW50IHRvIGluc2VydCBpbiBjYXNlIHdlJ3JlIGRvaW5nIGFuIHVwc2VydCBhbmQgdGhlXG4vLyBzZWxlY3RvciBkb2VzIG5vdCBtYXRjaCBhbnkgZWxlbWVudHNcbkxvY2FsQ29sbGVjdGlvbi5fY3JlYXRlVXBzZXJ0RG9jdW1lbnQgPSAoc2VsZWN0b3IsIG1vZGlmaWVyKSA9PiB7XG4gIGNvbnN0IHNlbGVjdG9yRG9jdW1lbnQgPSBwb3B1bGF0ZURvY3VtZW50V2l0aFF1ZXJ5RmllbGRzKHNlbGVjdG9yKTtcbiAgY29uc3QgaXNNb2RpZnkgPSBMb2NhbENvbGxlY3Rpb24uX2lzTW9kaWZpY2F0aW9uTW9kKG1vZGlmaWVyKTtcblxuICBjb25zdCBuZXdEb2MgPSB7fTtcblxuICBpZiAoc2VsZWN0b3JEb2N1bWVudC5faWQpIHtcbiAgICBuZXdEb2MuX2lkID0gc2VsZWN0b3JEb2N1bWVudC5faWQ7XG4gICAgZGVsZXRlIHNlbGVjdG9yRG9jdW1lbnQuX2lkO1xuICB9XG5cbiAgLy8gVGhpcyBkb3VibGUgX21vZGlmeSBjYWxsIGlzIG1hZGUgdG8gaGVscCB3aXRoIG5lc3RlZCBwcm9wZXJ0aWVzIChzZWUgaXNzdWVcbiAgLy8gIzg2MzEpLiBXZSBkbyB0aGlzIGV2ZW4gaWYgaXQncyBhIHJlcGxhY2VtZW50IGZvciB2YWxpZGF0aW9uIHB1cnBvc2VzIChlLmcuXG4gIC8vIGFtYmlndW91cyBpZCdzKVxuICBMb2NhbENvbGxlY3Rpb24uX21vZGlmeShuZXdEb2MsIHskc2V0OiBzZWxlY3RvckRvY3VtZW50fSk7XG4gIExvY2FsQ29sbGVjdGlvbi5fbW9kaWZ5KG5ld0RvYywgbW9kaWZpZXIsIHtpc0luc2VydDogdHJ1ZX0pO1xuXG4gIGlmIChpc01vZGlmeSkge1xuICAgIHJldHVybiBuZXdEb2M7XG4gIH1cblxuICAvLyBSZXBsYWNlbWVudCBjYW4gdGFrZSBfaWQgZnJvbSBxdWVyeSBkb2N1bWVudFxuICBjb25zdCByZXBsYWNlbWVudCA9IE9iamVjdC5hc3NpZ24oe30sIG1vZGlmaWVyKTtcbiAgaWYgKG5ld0RvYy5faWQpIHtcbiAgICByZXBsYWNlbWVudC5faWQgPSBuZXdEb2MuX2lkO1xuICB9XG5cbiAgcmV0dXJuIHJlcGxhY2VtZW50O1xufTtcblxuTG9jYWxDb2xsZWN0aW9uLl9kaWZmT2JqZWN0cyA9IChsZWZ0LCByaWdodCwgY2FsbGJhY2tzKSA9PiB7XG4gIHJldHVybiBEaWZmU2VxdWVuY2UuZGlmZk9iamVjdHMobGVmdCwgcmlnaHQsIGNhbGxiYWNrcyk7XG59O1xuXG4vLyBvcmRlcmVkOiBib29sLlxuLy8gb2xkX3Jlc3VsdHMgYW5kIG5ld19yZXN1bHRzOiBjb2xsZWN0aW9ucyBvZiBkb2N1bWVudHMuXG4vLyAgICBpZiBvcmRlcmVkLCB0aGV5IGFyZSBhcnJheXMuXG4vLyAgICBpZiB1bm9yZGVyZWQsIHRoZXkgYXJlIElkTWFwc1xuTG9jYWxDb2xsZWN0aW9uLl9kaWZmUXVlcnlDaGFuZ2VzID0gKG9yZGVyZWQsIG9sZFJlc3VsdHMsIG5ld1Jlc3VsdHMsIG9ic2VydmVyLCBvcHRpb25zKSA9PlxuICBEaWZmU2VxdWVuY2UuZGlmZlF1ZXJ5Q2hhbmdlcyhvcmRlcmVkLCBvbGRSZXN1bHRzLCBuZXdSZXN1bHRzLCBvYnNlcnZlciwgb3B0aW9ucylcbjtcblxuTG9jYWxDb2xsZWN0aW9uLl9kaWZmUXVlcnlPcmRlcmVkQ2hhbmdlcyA9IChvbGRSZXN1bHRzLCBuZXdSZXN1bHRzLCBvYnNlcnZlciwgb3B0aW9ucykgPT5cbiAgRGlmZlNlcXVlbmNlLmRpZmZRdWVyeU9yZGVyZWRDaGFuZ2VzKG9sZFJlc3VsdHMsIG5ld1Jlc3VsdHMsIG9ic2VydmVyLCBvcHRpb25zKVxuO1xuXG5Mb2NhbENvbGxlY3Rpb24uX2RpZmZRdWVyeVVub3JkZXJlZENoYW5nZXMgPSAob2xkUmVzdWx0cywgbmV3UmVzdWx0cywgb2JzZXJ2ZXIsIG9wdGlvbnMpID0+XG4gIERpZmZTZXF1ZW5jZS5kaWZmUXVlcnlVbm9yZGVyZWRDaGFuZ2VzKG9sZFJlc3VsdHMsIG5ld1Jlc3VsdHMsIG9ic2VydmVyLCBvcHRpb25zKVxuO1xuXG5Mb2NhbENvbGxlY3Rpb24uX2ZpbmRJbk9yZGVyZWRSZXN1bHRzID0gKHF1ZXJ5LCBkb2MpID0+IHtcbiAgaWYgKCFxdWVyeS5vcmRlcmVkKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdDYW5cXCd0IGNhbGwgX2ZpbmRJbk9yZGVyZWRSZXN1bHRzIG9uIHVub3JkZXJlZCBxdWVyeScpO1xuICB9XG5cbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBxdWVyeS5yZXN1bHRzLmxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKHF1ZXJ5LnJlc3VsdHNbaV0gPT09IGRvYykge1xuICAgICAgcmV0dXJuIGk7XG4gICAgfVxuICB9XG5cbiAgdGhyb3cgRXJyb3IoJ29iamVjdCBtaXNzaW5nIGZyb20gcXVlcnknKTtcbn07XG5cbi8vIElmIHRoaXMgaXMgYSBzZWxlY3RvciB3aGljaCBleHBsaWNpdGx5IGNvbnN0cmFpbnMgdGhlIG1hdGNoIGJ5IElEIHRvIGEgZmluaXRlXG4vLyBudW1iZXIgb2YgZG9jdW1lbnRzLCByZXR1cm5zIGEgbGlzdCBvZiB0aGVpciBJRHMuICBPdGhlcndpc2UgcmV0dXJuc1xuLy8gbnVsbC4gTm90ZSB0aGF0IHRoZSBzZWxlY3RvciBtYXkgaGF2ZSBvdGhlciByZXN0cmljdGlvbnMgc28gaXQgbWF5IG5vdCBldmVuXG4vLyBtYXRjaCB0aG9zZSBkb2N1bWVudCEgIFdlIGNhcmUgYWJvdXQgJGluIGFuZCAkYW5kIHNpbmNlIHRob3NlIGFyZSBnZW5lcmF0ZWRcbi8vIGFjY2Vzcy1jb250cm9sbGVkIHVwZGF0ZSBhbmQgcmVtb3ZlLlxuTG9jYWxDb2xsZWN0aW9uLl9pZHNNYXRjaGVkQnlTZWxlY3RvciA9IHNlbGVjdG9yID0+IHtcbiAgLy8gSXMgdGhlIHNlbGVjdG9yIGp1c3QgYW4gSUQ/XG4gIGlmIChMb2NhbENvbGxlY3Rpb24uX3NlbGVjdG9ySXNJZChzZWxlY3RvcikpIHtcbiAgICByZXR1cm4gW3NlbGVjdG9yXTtcbiAgfVxuXG4gIGlmICghc2VsZWN0b3IpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIC8vIERvIHdlIGhhdmUgYW4gX2lkIGNsYXVzZT9cbiAgaWYgKGhhc093bi5jYWxsKHNlbGVjdG9yLCAnX2lkJykpIHtcbiAgICAvLyBJcyB0aGUgX2lkIGNsYXVzZSBqdXN0IGFuIElEP1xuICAgIGlmIChMb2NhbENvbGxlY3Rpb24uX3NlbGVjdG9ySXNJZChzZWxlY3Rvci5faWQpKSB7XG4gICAgICByZXR1cm4gW3NlbGVjdG9yLl9pZF07XG4gICAgfVxuXG4gICAgLy8gSXMgdGhlIF9pZCBjbGF1c2Uge19pZDogeyRpbjogW1wieFwiLCBcInlcIiwgXCJ6XCJdfX0/XG4gICAgaWYgKHNlbGVjdG9yLl9pZFxuICAgICAgICAmJiBBcnJheS5pc0FycmF5KHNlbGVjdG9yLl9pZC4kaW4pXG4gICAgICAgICYmIHNlbGVjdG9yLl9pZC4kaW4ubGVuZ3RoXG4gICAgICAgICYmIHNlbGVjdG9yLl9pZC4kaW4uZXZlcnkoTG9jYWxDb2xsZWN0aW9uLl9zZWxlY3RvcklzSWQpKSB7XG4gICAgICByZXR1cm4gc2VsZWN0b3IuX2lkLiRpbjtcbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIC8vIElmIHRoaXMgaXMgYSB0b3AtbGV2ZWwgJGFuZCwgYW5kIGFueSBvZiB0aGUgY2xhdXNlcyBjb25zdHJhaW4gdGhlaXJcbiAgLy8gZG9jdW1lbnRzLCB0aGVuIHRoZSB3aG9sZSBzZWxlY3RvciBpcyBjb25zdHJhaW5lZCBieSBhbnkgb25lIGNsYXVzZSdzXG4gIC8vIGNvbnN0cmFpbnQuIChXZWxsLCBieSB0aGVpciBpbnRlcnNlY3Rpb24sIGJ1dCB0aGF0IHNlZW1zIHVubGlrZWx5LilcbiAgaWYgKEFycmF5LmlzQXJyYXkoc2VsZWN0b3IuJGFuZCkpIHtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHNlbGVjdG9yLiRhbmQubGVuZ3RoOyArK2kpIHtcbiAgICAgIGNvbnN0IHN1YklkcyA9IExvY2FsQ29sbGVjdGlvbi5faWRzTWF0Y2hlZEJ5U2VsZWN0b3Ioc2VsZWN0b3IuJGFuZFtpXSk7XG5cbiAgICAgIGlmIChzdWJJZHMpIHtcbiAgICAgICAgcmV0dXJuIHN1YklkcztcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gbnVsbDtcbn07XG5cbkxvY2FsQ29sbGVjdGlvbi5faW5zZXJ0SW5SZXN1bHRzID0gKHF1ZXJ5LCBkb2MpID0+IHtcbiAgY29uc3QgZmllbGRzID0gRUpTT04uY2xvbmUoZG9jKTtcblxuICBkZWxldGUgZmllbGRzLl9pZDtcblxuICBpZiAocXVlcnkub3JkZXJlZCkge1xuICAgIGlmICghcXVlcnkuc29ydGVyKSB7XG4gICAgICBxdWVyeS5hZGRlZEJlZm9yZShkb2MuX2lkLCBxdWVyeS5wcm9qZWN0aW9uRm4oZmllbGRzKSwgbnVsbCk7XG4gICAgICBxdWVyeS5yZXN1bHRzLnB1c2goZG9jKTtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgaSA9IExvY2FsQ29sbGVjdGlvbi5faW5zZXJ0SW5Tb3J0ZWRMaXN0KFxuICAgICAgICBxdWVyeS5zb3J0ZXIuZ2V0Q29tcGFyYXRvcih7ZGlzdGFuY2VzOiBxdWVyeS5kaXN0YW5jZXN9KSxcbiAgICAgICAgcXVlcnkucmVzdWx0cyxcbiAgICAgICAgZG9jXG4gICAgICApO1xuXG4gICAgICBsZXQgbmV4dCA9IHF1ZXJ5LnJlc3VsdHNbaSArIDFdO1xuICAgICAgaWYgKG5leHQpIHtcbiAgICAgICAgbmV4dCA9IG5leHQuX2lkO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbmV4dCA9IG51bGw7XG4gICAgICB9XG5cbiAgICAgIHF1ZXJ5LmFkZGVkQmVmb3JlKGRvYy5faWQsIHF1ZXJ5LnByb2plY3Rpb25GbihmaWVsZHMpLCBuZXh0KTtcbiAgICB9XG5cbiAgICBxdWVyeS5hZGRlZChkb2MuX2lkLCBxdWVyeS5wcm9qZWN0aW9uRm4oZmllbGRzKSk7XG4gIH0gZWxzZSB7XG4gICAgcXVlcnkuYWRkZWQoZG9jLl9pZCwgcXVlcnkucHJvamVjdGlvbkZuKGZpZWxkcykpO1xuICAgIHF1ZXJ5LnJlc3VsdHMuc2V0KGRvYy5faWQsIGRvYyk7XG4gIH1cbn07XG5cbkxvY2FsQ29sbGVjdGlvbi5faW5zZXJ0SW5Tb3J0ZWRMaXN0ID0gKGNtcCwgYXJyYXksIHZhbHVlKSA9PiB7XG4gIGlmIChhcnJheS5sZW5ndGggPT09IDApIHtcbiAgICBhcnJheS5wdXNoKHZhbHVlKTtcbiAgICByZXR1cm4gMDtcbiAgfVxuXG4gIGNvbnN0IGkgPSBMb2NhbENvbGxlY3Rpb24uX2JpbmFyeVNlYXJjaChjbXAsIGFycmF5LCB2YWx1ZSk7XG5cbiAgYXJyYXkuc3BsaWNlKGksIDAsIHZhbHVlKTtcblxuICByZXR1cm4gaTtcbn07XG5cbkxvY2FsQ29sbGVjdGlvbi5faXNNb2RpZmljYXRpb25Nb2QgPSBtb2QgPT4ge1xuICBsZXQgaXNNb2RpZnkgPSBmYWxzZTtcbiAgbGV0IGlzUmVwbGFjZSA9IGZhbHNlO1xuXG4gIE9iamVjdC5rZXlzKG1vZCkuZm9yRWFjaChrZXkgPT4ge1xuICAgIGlmIChrZXkuc3Vic3RyKDAsIDEpID09PSAnJCcpIHtcbiAgICAgIGlzTW9kaWZ5ID0gdHJ1ZTtcbiAgICB9IGVsc2Uge1xuICAgICAgaXNSZXBsYWNlID0gdHJ1ZTtcbiAgICB9XG4gIH0pO1xuXG4gIGlmIChpc01vZGlmeSAmJiBpc1JlcGxhY2UpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAnVXBkYXRlIHBhcmFtZXRlciBjYW5ub3QgaGF2ZSBib3RoIG1vZGlmaWVyIGFuZCBub24tbW9kaWZpZXIgZmllbGRzLidcbiAgICApO1xuICB9XG5cbiAgcmV0dXJuIGlzTW9kaWZ5O1xufTtcblxuLy8gWFhYIG1heWJlIHRoaXMgc2hvdWxkIGJlIEVKU09OLmlzT2JqZWN0LCB0aG91Z2ggRUpTT04gZG9lc24ndCBrbm93IGFib3V0XG4vLyBSZWdFeHBcbi8vIFhYWCBub3RlIHRoYXQgX3R5cGUodW5kZWZpbmVkKSA9PT0gMyEhISFcbkxvY2FsQ29sbGVjdGlvbi5faXNQbGFpbk9iamVjdCA9IHggPT4ge1xuICByZXR1cm4geCAmJiBMb2NhbENvbGxlY3Rpb24uX2YuX3R5cGUoeCkgPT09IDM7XG59O1xuXG4vLyBYWFggbmVlZCBhIHN0cmF0ZWd5IGZvciBwYXNzaW5nIHRoZSBiaW5kaW5nIG9mICQgaW50byB0aGlzXG4vLyBmdW5jdGlvbiwgZnJvbSB0aGUgY29tcGlsZWQgc2VsZWN0b3Jcbi8vXG4vLyBtYXliZSBqdXN0IHtrZXkudXAudG8uanVzdC5iZWZvcmUuZG9sbGFyc2lnbjogYXJyYXlfaW5kZXh9XG4vL1xuLy8gWFhYIGF0b21pY2l0eTogaWYgb25lIG1vZGlmaWNhdGlvbiBmYWlscywgZG8gd2Ugcm9sbCBiYWNrIHRoZSB3aG9sZVxuLy8gY2hhbmdlP1xuLy9cbi8vIG9wdGlvbnM6XG4vLyAgIC0gaXNJbnNlcnQgaXMgc2V0IHdoZW4gX21vZGlmeSBpcyBiZWluZyBjYWxsZWQgdG8gY29tcHV0ZSB0aGUgZG9jdW1lbnQgdG9cbi8vICAgICBpbnNlcnQgYXMgcGFydCBvZiBhbiB1cHNlcnQgb3BlcmF0aW9uLiBXZSB1c2UgdGhpcyBwcmltYXJpbHkgdG8gZmlndXJlXG4vLyAgICAgb3V0IHdoZW4gdG8gc2V0IHRoZSBmaWVsZHMgaW4gJHNldE9uSW5zZXJ0LCBpZiBwcmVzZW50LlxuTG9jYWxDb2xsZWN0aW9uLl9tb2RpZnkgPSAoZG9jLCBtb2RpZmllciwgb3B0aW9ucyA9IHt9KSA9PiB7XG4gIGlmICghTG9jYWxDb2xsZWN0aW9uLl9pc1BsYWluT2JqZWN0KG1vZGlmaWVyKSkge1xuICAgIHRocm93IE1pbmltb25nb0Vycm9yKCdNb2RpZmllciBtdXN0IGJlIGFuIG9iamVjdCcpO1xuICB9XG5cbiAgLy8gTWFrZSBzdXJlIHRoZSBjYWxsZXIgY2FuJ3QgbXV0YXRlIG91ciBkYXRhIHN0cnVjdHVyZXMuXG4gIG1vZGlmaWVyID0gRUpTT04uY2xvbmUobW9kaWZpZXIpO1xuXG4gIGNvbnN0IGlzTW9kaWZpZXIgPSBpc09wZXJhdG9yT2JqZWN0KG1vZGlmaWVyKTtcbiAgY29uc3QgbmV3RG9jID0gaXNNb2RpZmllciA/IEVKU09OLmNsb25lKGRvYykgOiBtb2RpZmllcjtcblxuICBpZiAoaXNNb2RpZmllcikge1xuICAgIC8vIGFwcGx5IG1vZGlmaWVycyB0byB0aGUgZG9jLlxuICAgIE9iamVjdC5rZXlzKG1vZGlmaWVyKS5mb3JFYWNoKG9wZXJhdG9yID0+IHtcbiAgICAgIC8vIFRyZWF0ICRzZXRPbkluc2VydCBhcyAkc2V0IGlmIHRoaXMgaXMgYW4gaW5zZXJ0LlxuICAgICAgY29uc3Qgc2V0T25JbnNlcnQgPSBvcHRpb25zLmlzSW5zZXJ0ICYmIG9wZXJhdG9yID09PSAnJHNldE9uSW5zZXJ0JztcbiAgICAgIGNvbnN0IG1vZEZ1bmMgPSBNT0RJRklFUlNbc2V0T25JbnNlcnQgPyAnJHNldCcgOiBvcGVyYXRvcl07XG4gICAgICBjb25zdCBvcGVyYW5kID0gbW9kaWZpZXJbb3BlcmF0b3JdO1xuXG4gICAgICBpZiAoIW1vZEZ1bmMpIHtcbiAgICAgICAgdGhyb3cgTWluaW1vbmdvRXJyb3IoYEludmFsaWQgbW9kaWZpZXIgc3BlY2lmaWVkICR7b3BlcmF0b3J9YCk7XG4gICAgICB9XG5cbiAgICAgIE9iamVjdC5rZXlzKG9wZXJhbmQpLmZvckVhY2goa2V5cGF0aCA9PiB7XG4gICAgICAgIGNvbnN0IGFyZyA9IG9wZXJhbmRba2V5cGF0aF07XG5cbiAgICAgICAgaWYgKGtleXBhdGggPT09ICcnKSB7XG4gICAgICAgICAgdGhyb3cgTWluaW1vbmdvRXJyb3IoJ0FuIGVtcHR5IHVwZGF0ZSBwYXRoIGlzIG5vdCB2YWxpZC4nKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGtleXBhcnRzID0ga2V5cGF0aC5zcGxpdCgnLicpO1xuXG4gICAgICAgIGlmICgha2V5cGFydHMuZXZlcnkoQm9vbGVhbikpIHtcbiAgICAgICAgICB0aHJvdyBNaW5pbW9uZ29FcnJvcihcbiAgICAgICAgICAgIGBUaGUgdXBkYXRlIHBhdGggJyR7a2V5cGF0aH0nIGNvbnRhaW5zIGFuIGVtcHR5IGZpZWxkIG5hbWUsIGAgK1xuICAgICAgICAgICAgJ3doaWNoIGlzIG5vdCBhbGxvd2VkLidcbiAgICAgICAgICApO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgdGFyZ2V0ID0gZmluZE1vZFRhcmdldChuZXdEb2MsIGtleXBhcnRzLCB7XG4gICAgICAgICAgYXJyYXlJbmRpY2VzOiBvcHRpb25zLmFycmF5SW5kaWNlcyxcbiAgICAgICAgICBmb3JiaWRBcnJheTogb3BlcmF0b3IgPT09ICckcmVuYW1lJyxcbiAgICAgICAgICBub0NyZWF0ZTogTk9fQ1JFQVRFX01PRElGSUVSU1tvcGVyYXRvcl1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgbW9kRnVuYyh0YXJnZXQsIGtleXBhcnRzLnBvcCgpLCBhcmcsIGtleXBhdGgsIG5ld0RvYyk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGlmIChkb2MuX2lkICYmICFFSlNPTi5lcXVhbHMoZG9jLl9pZCwgbmV3RG9jLl9pZCkpIHtcbiAgICAgIHRocm93IE1pbmltb25nb0Vycm9yKFxuICAgICAgICBgQWZ0ZXIgYXBwbHlpbmcgdGhlIHVwZGF0ZSB0byB0aGUgZG9jdW1lbnQge19pZDogXCIke2RvYy5faWR9XCIsIC4uLn0sYCArXG4gICAgICAgICcgdGhlIChpbW11dGFibGUpIGZpZWxkIFxcJ19pZFxcJyB3YXMgZm91bmQgdG8gaGF2ZSBiZWVuIGFsdGVyZWQgdG8gJyArXG4gICAgICAgIGBfaWQ6IFwiJHtuZXdEb2MuX2lkfVwiYFxuICAgICAgKTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgaWYgKGRvYy5faWQgJiYgbW9kaWZpZXIuX2lkICYmICFFSlNPTi5lcXVhbHMoZG9jLl9pZCwgbW9kaWZpZXIuX2lkKSkge1xuICAgICAgdGhyb3cgTWluaW1vbmdvRXJyb3IoXG4gICAgICAgIGBUaGUgX2lkIGZpZWxkIGNhbm5vdCBiZSBjaGFuZ2VkIGZyb20ge19pZDogXCIke2RvYy5faWR9XCJ9IHRvIGAgK1xuICAgICAgICBge19pZDogXCIke21vZGlmaWVyLl9pZH1cIn1gXG4gICAgICApO1xuICAgIH1cblxuICAgIC8vIHJlcGxhY2UgdGhlIHdob2xlIGRvY3VtZW50XG4gICAgYXNzZXJ0SGFzVmFsaWRGaWVsZE5hbWVzKG1vZGlmaWVyKTtcbiAgfVxuXG4gIC8vIG1vdmUgbmV3IGRvY3VtZW50IGludG8gcGxhY2UuXG4gIE9iamVjdC5rZXlzKGRvYykuZm9yRWFjaChrZXkgPT4ge1xuICAgIC8vIE5vdGU6IHRoaXMgdXNlZCB0byBiZSBmb3IgKHZhciBrZXkgaW4gZG9jKSBob3dldmVyLCB0aGlzIGRvZXMgbm90XG4gICAgLy8gd29yayByaWdodCBpbiBPcGVyYS4gRGVsZXRpbmcgZnJvbSBhIGRvYyB3aGlsZSBpdGVyYXRpbmcgb3ZlciBpdFxuICAgIC8vIHdvdWxkIHNvbWV0aW1lcyBjYXVzZSBvcGVyYSB0byBza2lwIHNvbWUga2V5cy5cbiAgICBpZiAoa2V5ICE9PSAnX2lkJykge1xuICAgICAgZGVsZXRlIGRvY1trZXldO1xuICAgIH1cbiAgfSk7XG5cbiAgT2JqZWN0LmtleXMobmV3RG9jKS5mb3JFYWNoKGtleSA9PiB7XG4gICAgZG9jW2tleV0gPSBuZXdEb2Nba2V5XTtcbiAgfSk7XG59O1xuXG5Mb2NhbENvbGxlY3Rpb24uX29ic2VydmVGcm9tT2JzZXJ2ZUNoYW5nZXMgPSAoY3Vyc29yLCBvYnNlcnZlQ2FsbGJhY2tzKSA9PiB7XG4gIGNvbnN0IHRyYW5zZm9ybSA9IGN1cnNvci5nZXRUcmFuc2Zvcm0oKSB8fCAoZG9jID0+IGRvYyk7XG4gIGxldCBzdXBwcmVzc2VkID0gISFvYnNlcnZlQ2FsbGJhY2tzLl9zdXBwcmVzc19pbml0aWFsO1xuXG4gIGxldCBvYnNlcnZlQ2hhbmdlc0NhbGxiYWNrcztcbiAgaWYgKExvY2FsQ29sbGVjdGlvbi5fb2JzZXJ2ZUNhbGxiYWNrc0FyZU9yZGVyZWQob2JzZXJ2ZUNhbGxiYWNrcykpIHtcbiAgICAvLyBUaGUgXCJfbm9faW5kaWNlc1wiIG9wdGlvbiBzZXRzIGFsbCBpbmRleCBhcmd1bWVudHMgdG8gLTEgYW5kIHNraXBzIHRoZVxuICAgIC8vIGxpbmVhciBzY2FucyByZXF1aXJlZCB0byBnZW5lcmF0ZSB0aGVtLiAgVGhpcyBsZXRzIG9ic2VydmVycyB0aGF0IGRvbid0XG4gICAgLy8gbmVlZCBhYnNvbHV0ZSBpbmRpY2VzIGJlbmVmaXQgZnJvbSB0aGUgb3RoZXIgZmVhdHVyZXMgb2YgdGhpcyBBUEkgLS1cbiAgICAvLyByZWxhdGl2ZSBvcmRlciwgdHJhbnNmb3JtcywgYW5kIGFwcGx5Q2hhbmdlcyAtLSB3aXRob3V0IHRoZSBzcGVlZCBoaXQuXG4gICAgY29uc3QgaW5kaWNlcyA9ICFvYnNlcnZlQ2FsbGJhY2tzLl9ub19pbmRpY2VzO1xuXG4gICAgb2JzZXJ2ZUNoYW5nZXNDYWxsYmFja3MgPSB7XG4gICAgICBhZGRlZEJlZm9yZShpZCwgZmllbGRzLCBiZWZvcmUpIHtcbiAgICAgICAgaWYgKHN1cHByZXNzZWQgfHwgIShvYnNlcnZlQ2FsbGJhY2tzLmFkZGVkQXQgfHwgb2JzZXJ2ZUNhbGxiYWNrcy5hZGRlZCkpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBkb2MgPSB0cmFuc2Zvcm0oT2JqZWN0LmFzc2lnbihmaWVsZHMsIHtfaWQ6IGlkfSkpO1xuXG4gICAgICAgIGlmIChvYnNlcnZlQ2FsbGJhY2tzLmFkZGVkQXQpIHtcbiAgICAgICAgICBvYnNlcnZlQ2FsbGJhY2tzLmFkZGVkQXQoXG4gICAgICAgICAgICBkb2MsXG4gICAgICAgICAgICBpbmRpY2VzXG4gICAgICAgICAgICAgID8gYmVmb3JlXG4gICAgICAgICAgICAgICAgPyB0aGlzLmRvY3MuaW5kZXhPZihiZWZvcmUpXG4gICAgICAgICAgICAgICAgOiB0aGlzLmRvY3Muc2l6ZSgpXG4gICAgICAgICAgICAgIDogLTEsXG4gICAgICAgICAgICBiZWZvcmVcbiAgICAgICAgICApO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIG9ic2VydmVDYWxsYmFja3MuYWRkZWQoZG9jKTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIGNoYW5nZWQoaWQsIGZpZWxkcykge1xuICAgICAgICBpZiAoIShvYnNlcnZlQ2FsbGJhY2tzLmNoYW5nZWRBdCB8fCBvYnNlcnZlQ2FsbGJhY2tzLmNoYW5nZWQpKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgbGV0IGRvYyA9IEVKU09OLmNsb25lKHRoaXMuZG9jcy5nZXQoaWQpKTtcbiAgICAgICAgaWYgKCFkb2MpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gaWQgZm9yIGNoYW5nZWQ6ICR7aWR9YCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBvbGREb2MgPSB0cmFuc2Zvcm0oRUpTT04uY2xvbmUoZG9jKSk7XG5cbiAgICAgICAgRGlmZlNlcXVlbmNlLmFwcGx5Q2hhbmdlcyhkb2MsIGZpZWxkcyk7XG5cbiAgICAgICAgaWYgKG9ic2VydmVDYWxsYmFja3MuY2hhbmdlZEF0KSB7XG4gICAgICAgICAgb2JzZXJ2ZUNhbGxiYWNrcy5jaGFuZ2VkQXQoXG4gICAgICAgICAgICB0cmFuc2Zvcm0oZG9jKSxcbiAgICAgICAgICAgIG9sZERvYyxcbiAgICAgICAgICAgIGluZGljZXMgPyB0aGlzLmRvY3MuaW5kZXhPZihpZCkgOiAtMVxuICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgb2JzZXJ2ZUNhbGxiYWNrcy5jaGFuZ2VkKHRyYW5zZm9ybShkb2MpLCBvbGREb2MpO1xuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgbW92ZWRCZWZvcmUoaWQsIGJlZm9yZSkge1xuICAgICAgICBpZiAoIW9ic2VydmVDYWxsYmFja3MubW92ZWRUbykge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGZyb20gPSBpbmRpY2VzID8gdGhpcy5kb2NzLmluZGV4T2YoaWQpIDogLTE7XG4gICAgICAgIGxldCB0byA9IGluZGljZXNcbiAgICAgICAgICA/IGJlZm9yZVxuICAgICAgICAgICAgPyB0aGlzLmRvY3MuaW5kZXhPZihiZWZvcmUpXG4gICAgICAgICAgICA6IHRoaXMuZG9jcy5zaXplKClcbiAgICAgICAgICA6IC0xO1xuXG4gICAgICAgIC8vIFdoZW4gbm90IG1vdmluZyBiYWNrd2FyZHMsIGFkanVzdCBmb3IgdGhlIGZhY3QgdGhhdCByZW1vdmluZyB0aGVcbiAgICAgICAgLy8gZG9jdW1lbnQgc2xpZGVzIGV2ZXJ5dGhpbmcgYmFjayBvbmUgc2xvdC5cbiAgICAgICAgaWYgKHRvID4gZnJvbSkge1xuICAgICAgICAgIC0tdG87XG4gICAgICAgIH1cblxuICAgICAgICBvYnNlcnZlQ2FsbGJhY2tzLm1vdmVkVG8oXG4gICAgICAgICAgdHJhbnNmb3JtKEVKU09OLmNsb25lKHRoaXMuZG9jcy5nZXQoaWQpKSksXG4gICAgICAgICAgZnJvbSxcbiAgICAgICAgICB0byxcbiAgICAgICAgICBiZWZvcmUgfHwgbnVsbFxuICAgICAgICApO1xuICAgICAgfSxcbiAgICAgIHJlbW92ZWQoaWQpIHtcbiAgICAgICAgaWYgKCEob2JzZXJ2ZUNhbGxiYWNrcy5yZW1vdmVkQXQgfHwgb2JzZXJ2ZUNhbGxiYWNrcy5yZW1vdmVkKSkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHRlY2huaWNhbGx5IG1heWJlIHRoZXJlIHNob3VsZCBiZSBhbiBFSlNPTi5jbG9uZSBoZXJlLCBidXQgaXQncyBhYm91dFxuICAgICAgICAvLyB0byBiZSByZW1vdmVkIGZyb20gdGhpcy5kb2NzIVxuICAgICAgICBjb25zdCBkb2MgPSB0cmFuc2Zvcm0odGhpcy5kb2NzLmdldChpZCkpO1xuXG4gICAgICAgIGlmIChvYnNlcnZlQ2FsbGJhY2tzLnJlbW92ZWRBdCkge1xuICAgICAgICAgIG9ic2VydmVDYWxsYmFja3MucmVtb3ZlZEF0KGRvYywgaW5kaWNlcyA/IHRoaXMuZG9jcy5pbmRleE9mKGlkKSA6IC0xKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBvYnNlcnZlQ2FsbGJhY2tzLnJlbW92ZWQoZG9jKTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICB9O1xuICB9IGVsc2Uge1xuICAgIG9ic2VydmVDaGFuZ2VzQ2FsbGJhY2tzID0ge1xuICAgICAgYWRkZWQoaWQsIGZpZWxkcykge1xuICAgICAgICBpZiAoIXN1cHByZXNzZWQgJiYgb2JzZXJ2ZUNhbGxiYWNrcy5hZGRlZCkge1xuICAgICAgICAgIG9ic2VydmVDYWxsYmFja3MuYWRkZWQodHJhbnNmb3JtKE9iamVjdC5hc3NpZ24oZmllbGRzLCB7X2lkOiBpZH0pKSk7XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBjaGFuZ2VkKGlkLCBmaWVsZHMpIHtcbiAgICAgICAgaWYgKG9ic2VydmVDYWxsYmFja3MuY2hhbmdlZCkge1xuICAgICAgICAgIGNvbnN0IG9sZERvYyA9IHRoaXMuZG9jcy5nZXQoaWQpO1xuICAgICAgICAgIGNvbnN0IGRvYyA9IEVKU09OLmNsb25lKG9sZERvYyk7XG5cbiAgICAgICAgICBEaWZmU2VxdWVuY2UuYXBwbHlDaGFuZ2VzKGRvYywgZmllbGRzKTtcblxuICAgICAgICAgIG9ic2VydmVDYWxsYmFja3MuY2hhbmdlZChcbiAgICAgICAgICAgIHRyYW5zZm9ybShkb2MpLFxuICAgICAgICAgICAgdHJhbnNmb3JtKEVKU09OLmNsb25lKG9sZERvYykpXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIHJlbW92ZWQoaWQpIHtcbiAgICAgICAgaWYgKG9ic2VydmVDYWxsYmFja3MucmVtb3ZlZCkge1xuICAgICAgICAgIG9ic2VydmVDYWxsYmFja3MucmVtb3ZlZCh0cmFuc2Zvcm0odGhpcy5kb2NzLmdldChpZCkpKTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICB9O1xuICB9XG5cbiAgY29uc3QgY2hhbmdlT2JzZXJ2ZXIgPSBuZXcgTG9jYWxDb2xsZWN0aW9uLl9DYWNoaW5nQ2hhbmdlT2JzZXJ2ZXIoe1xuICAgIGNhbGxiYWNrczogb2JzZXJ2ZUNoYW5nZXNDYWxsYmFja3NcbiAgfSk7XG5cbiAgY29uc3QgaGFuZGxlID0gY3Vyc29yLm9ic2VydmVDaGFuZ2VzKGNoYW5nZU9ic2VydmVyLmFwcGx5Q2hhbmdlKTtcblxuICBzdXBwcmVzc2VkID0gZmFsc2U7XG5cbiAgcmV0dXJuIGhhbmRsZTtcbn07XG5cbkxvY2FsQ29sbGVjdGlvbi5fb2JzZXJ2ZUNhbGxiYWNrc0FyZU9yZGVyZWQgPSBjYWxsYmFja3MgPT4ge1xuICBpZiAoY2FsbGJhY2tzLmFkZGVkICYmIGNhbGxiYWNrcy5hZGRlZEF0KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdQbGVhc2Ugc3BlY2lmeSBvbmx5IG9uZSBvZiBhZGRlZCgpIGFuZCBhZGRlZEF0KCknKTtcbiAgfVxuXG4gIGlmIChjYWxsYmFja3MuY2hhbmdlZCAmJiBjYWxsYmFja3MuY2hhbmdlZEF0KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdQbGVhc2Ugc3BlY2lmeSBvbmx5IG9uZSBvZiBjaGFuZ2VkKCkgYW5kIGNoYW5nZWRBdCgpJyk7XG4gIH1cblxuICBpZiAoY2FsbGJhY2tzLnJlbW92ZWQgJiYgY2FsbGJhY2tzLnJlbW92ZWRBdCkge1xuICAgIHRocm93IG5ldyBFcnJvcignUGxlYXNlIHNwZWNpZnkgb25seSBvbmUgb2YgcmVtb3ZlZCgpIGFuZCByZW1vdmVkQXQoKScpO1xuICB9XG5cbiAgcmV0dXJuICEhKFxuICAgIGNhbGxiYWNrcy5hZGRlZEF0IHx8XG4gICAgY2FsbGJhY2tzLmNoYW5nZWRBdCB8fFxuICAgIGNhbGxiYWNrcy5tb3ZlZFRvIHx8XG4gICAgY2FsbGJhY2tzLnJlbW92ZWRBdFxuICApO1xufTtcblxuTG9jYWxDb2xsZWN0aW9uLl9vYnNlcnZlQ2hhbmdlc0NhbGxiYWNrc0FyZU9yZGVyZWQgPSBjYWxsYmFja3MgPT4ge1xuICBpZiAoY2FsbGJhY2tzLmFkZGVkICYmIGNhbGxiYWNrcy5hZGRlZEJlZm9yZSkge1xuICAgIHRocm93IG5ldyBFcnJvcignUGxlYXNlIHNwZWNpZnkgb25seSBvbmUgb2YgYWRkZWQoKSBhbmQgYWRkZWRCZWZvcmUoKScpO1xuICB9XG5cbiAgcmV0dXJuICEhKGNhbGxiYWNrcy5hZGRlZEJlZm9yZSB8fCBjYWxsYmFja3MubW92ZWRCZWZvcmUpO1xufTtcblxuTG9jYWxDb2xsZWN0aW9uLl9yZW1vdmVGcm9tUmVzdWx0cyA9IChxdWVyeSwgZG9jKSA9PiB7XG4gIGlmIChxdWVyeS5vcmRlcmVkKSB7XG4gICAgY29uc3QgaSA9IExvY2FsQ29sbGVjdGlvbi5fZmluZEluT3JkZXJlZFJlc3VsdHMocXVlcnksIGRvYyk7XG5cbiAgICBxdWVyeS5yZW1vdmVkKGRvYy5faWQpO1xuICAgIHF1ZXJ5LnJlc3VsdHMuc3BsaWNlKGksIDEpO1xuICB9IGVsc2Uge1xuICAgIGNvbnN0IGlkID0gZG9jLl9pZDsgIC8vIGluIGNhc2UgY2FsbGJhY2sgbXV0YXRlcyBkb2NcblxuICAgIHF1ZXJ5LnJlbW92ZWQoZG9jLl9pZCk7XG4gICAgcXVlcnkucmVzdWx0cy5yZW1vdmUoaWQpO1xuICB9XG59O1xuXG4vLyBJcyB0aGlzIHNlbGVjdG9yIGp1c3Qgc2hvcnRoYW5kIGZvciBsb29rdXAgYnkgX2lkP1xuTG9jYWxDb2xsZWN0aW9uLl9zZWxlY3RvcklzSWQgPSBzZWxlY3RvciA9PlxuICB0eXBlb2Ygc2VsZWN0b3IgPT09ICdudW1iZXInIHx8XG4gIHR5cGVvZiBzZWxlY3RvciA9PT0gJ3N0cmluZycgfHxcbiAgc2VsZWN0b3IgaW5zdGFuY2VvZiBNb25nb0lELk9iamVjdElEXG47XG5cbi8vIElzIHRoZSBzZWxlY3RvciBqdXN0IGxvb2t1cCBieSBfaWQgKHNob3J0aGFuZCBvciBub3QpP1xuTG9jYWxDb2xsZWN0aW9uLl9zZWxlY3RvcklzSWRQZXJoYXBzQXNPYmplY3QgPSBzZWxlY3RvciA9PlxuICBMb2NhbENvbGxlY3Rpb24uX3NlbGVjdG9ySXNJZChzZWxlY3RvcikgfHxcbiAgTG9jYWxDb2xsZWN0aW9uLl9zZWxlY3RvcklzSWQoc2VsZWN0b3IgJiYgc2VsZWN0b3IuX2lkKSAmJlxuICBPYmplY3Qua2V5cyhzZWxlY3RvcikubGVuZ3RoID09PSAxXG47XG5cbkxvY2FsQ29sbGVjdGlvbi5fdXBkYXRlSW5SZXN1bHRzID0gKHF1ZXJ5LCBkb2MsIG9sZF9kb2MpID0+IHtcbiAgaWYgKCFFSlNPTi5lcXVhbHMoZG9jLl9pZCwgb2xkX2RvYy5faWQpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdDYW5cXCd0IGNoYW5nZSBhIGRvY1xcJ3MgX2lkIHdoaWxlIHVwZGF0aW5nJyk7XG4gIH1cblxuICBjb25zdCBwcm9qZWN0aW9uRm4gPSBxdWVyeS5wcm9qZWN0aW9uRm47XG4gIGNvbnN0IGNoYW5nZWRGaWVsZHMgPSBEaWZmU2VxdWVuY2UubWFrZUNoYW5nZWRGaWVsZHMoXG4gICAgcHJvamVjdGlvbkZuKGRvYyksXG4gICAgcHJvamVjdGlvbkZuKG9sZF9kb2MpXG4gICk7XG5cbiAgaWYgKCFxdWVyeS5vcmRlcmVkKSB7XG4gICAgaWYgKE9iamVjdC5rZXlzKGNoYW5nZWRGaWVsZHMpLmxlbmd0aCkge1xuICAgICAgcXVlcnkuY2hhbmdlZChkb2MuX2lkLCBjaGFuZ2VkRmllbGRzKTtcbiAgICAgIHF1ZXJ5LnJlc3VsdHMuc2V0KGRvYy5faWQsIGRvYyk7XG4gICAgfVxuXG4gICAgcmV0dXJuO1xuICB9XG5cbiAgY29uc3Qgb2xkX2lkeCA9IExvY2FsQ29sbGVjdGlvbi5fZmluZEluT3JkZXJlZFJlc3VsdHMocXVlcnksIGRvYyk7XG5cbiAgaWYgKE9iamVjdC5rZXlzKGNoYW5nZWRGaWVsZHMpLmxlbmd0aCkge1xuICAgIHF1ZXJ5LmNoYW5nZWQoZG9jLl9pZCwgY2hhbmdlZEZpZWxkcyk7XG4gIH1cblxuICBpZiAoIXF1ZXJ5LnNvcnRlcikge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIGp1c3QgdGFrZSBpdCBvdXQgYW5kIHB1dCBpdCBiYWNrIGluIGFnYWluLCBhbmQgc2VlIGlmIHRoZSBpbmRleCBjaGFuZ2VzXG4gIHF1ZXJ5LnJlc3VsdHMuc3BsaWNlKG9sZF9pZHgsIDEpO1xuXG4gIGNvbnN0IG5ld19pZHggPSBMb2NhbENvbGxlY3Rpb24uX2luc2VydEluU29ydGVkTGlzdChcbiAgICBxdWVyeS5zb3J0ZXIuZ2V0Q29tcGFyYXRvcih7ZGlzdGFuY2VzOiBxdWVyeS5kaXN0YW5jZXN9KSxcbiAgICBxdWVyeS5yZXN1bHRzLFxuICAgIGRvY1xuICApO1xuXG4gIGlmIChvbGRfaWR4ICE9PSBuZXdfaWR4KSB7XG4gICAgbGV0IG5leHQgPSBxdWVyeS5yZXN1bHRzW25ld19pZHggKyAxXTtcbiAgICBpZiAobmV4dCkge1xuICAgICAgbmV4dCA9IG5leHQuX2lkO1xuICAgIH0gZWxzZSB7XG4gICAgICBuZXh0ID0gbnVsbDtcbiAgICB9XG5cbiAgICBxdWVyeS5tb3ZlZEJlZm9yZSAmJiBxdWVyeS5tb3ZlZEJlZm9yZShkb2MuX2lkLCBuZXh0KTtcbiAgfVxufTtcblxuY29uc3QgTU9ESUZJRVJTID0ge1xuICAkY3VycmVudERhdGUodGFyZ2V0LCBmaWVsZCwgYXJnKSB7XG4gICAgaWYgKHR5cGVvZiBhcmcgPT09ICdvYmplY3QnICYmIGhhc093bi5jYWxsKGFyZywgJyR0eXBlJykpIHtcbiAgICAgIGlmIChhcmcuJHR5cGUgIT09ICdkYXRlJykge1xuICAgICAgICB0aHJvdyBNaW5pbW9uZ29FcnJvcihcbiAgICAgICAgICAnTWluaW1vbmdvIGRvZXMgY3VycmVudGx5IG9ubHkgc3VwcG9ydCB0aGUgZGF0ZSB0eXBlIGluICcgK1xuICAgICAgICAgICckY3VycmVudERhdGUgbW9kaWZpZXJzJyxcbiAgICAgICAgICB7ZmllbGR9XG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChhcmcgIT09IHRydWUpIHtcbiAgICAgIHRocm93IE1pbmltb25nb0Vycm9yKCdJbnZhbGlkICRjdXJyZW50RGF0ZSBtb2RpZmllcicsIHtmaWVsZH0pO1xuICAgIH1cblxuICAgIHRhcmdldFtmaWVsZF0gPSBuZXcgRGF0ZSgpO1xuICB9LFxuICAkbWluKHRhcmdldCwgZmllbGQsIGFyZykge1xuICAgIGlmICh0eXBlb2YgYXJnICE9PSAnbnVtYmVyJykge1xuICAgICAgdGhyb3cgTWluaW1vbmdvRXJyb3IoJ01vZGlmaWVyICRtaW4gYWxsb3dlZCBmb3IgbnVtYmVycyBvbmx5Jywge2ZpZWxkfSk7XG4gICAgfVxuXG4gICAgaWYgKGZpZWxkIGluIHRhcmdldCkge1xuICAgICAgaWYgKHR5cGVvZiB0YXJnZXRbZmllbGRdICE9PSAnbnVtYmVyJykge1xuICAgICAgICB0aHJvdyBNaW5pbW9uZ29FcnJvcihcbiAgICAgICAgICAnQ2Fubm90IGFwcGx5ICRtaW4gbW9kaWZpZXIgdG8gbm9uLW51bWJlcicsXG4gICAgICAgICAge2ZpZWxkfVxuICAgICAgICApO1xuICAgICAgfVxuXG4gICAgICBpZiAodGFyZ2V0W2ZpZWxkXSA+IGFyZykge1xuICAgICAgICB0YXJnZXRbZmllbGRdID0gYXJnO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0YXJnZXRbZmllbGRdID0gYXJnO1xuICAgIH1cbiAgfSxcbiAgJG1heCh0YXJnZXQsIGZpZWxkLCBhcmcpIHtcbiAgICBpZiAodHlwZW9mIGFyZyAhPT0gJ251bWJlcicpIHtcbiAgICAgIHRocm93IE1pbmltb25nb0Vycm9yKCdNb2RpZmllciAkbWF4IGFsbG93ZWQgZm9yIG51bWJlcnMgb25seScsIHtmaWVsZH0pO1xuICAgIH1cblxuICAgIGlmIChmaWVsZCBpbiB0YXJnZXQpIHtcbiAgICAgIGlmICh0eXBlb2YgdGFyZ2V0W2ZpZWxkXSAhPT0gJ251bWJlcicpIHtcbiAgICAgICAgdGhyb3cgTWluaW1vbmdvRXJyb3IoXG4gICAgICAgICAgJ0Nhbm5vdCBhcHBseSAkbWF4IG1vZGlmaWVyIHRvIG5vbi1udW1iZXInLFxuICAgICAgICAgIHtmaWVsZH1cbiAgICAgICAgKTtcbiAgICAgIH1cblxuICAgICAgaWYgKHRhcmdldFtmaWVsZF0gPCBhcmcpIHtcbiAgICAgICAgdGFyZ2V0W2ZpZWxkXSA9IGFyZztcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgdGFyZ2V0W2ZpZWxkXSA9IGFyZztcbiAgICB9XG4gIH0sXG4gICRpbmModGFyZ2V0LCBmaWVsZCwgYXJnKSB7XG4gICAgaWYgKHR5cGVvZiBhcmcgIT09ICdudW1iZXInKSB7XG4gICAgICB0aHJvdyBNaW5pbW9uZ29FcnJvcignTW9kaWZpZXIgJGluYyBhbGxvd2VkIGZvciBudW1iZXJzIG9ubHknLCB7ZmllbGR9KTtcbiAgICB9XG5cbiAgICBpZiAoZmllbGQgaW4gdGFyZ2V0KSB7XG4gICAgICBpZiAodHlwZW9mIHRhcmdldFtmaWVsZF0gIT09ICdudW1iZXInKSB7XG4gICAgICAgIHRocm93IE1pbmltb25nb0Vycm9yKFxuICAgICAgICAgICdDYW5ub3QgYXBwbHkgJGluYyBtb2RpZmllciB0byBub24tbnVtYmVyJyxcbiAgICAgICAgICB7ZmllbGR9XG4gICAgICAgICk7XG4gICAgICB9XG5cbiAgICAgIHRhcmdldFtmaWVsZF0gKz0gYXJnO1xuICAgIH0gZWxzZSB7XG4gICAgICB0YXJnZXRbZmllbGRdID0gYXJnO1xuICAgIH1cbiAgfSxcbiAgJHNldCh0YXJnZXQsIGZpZWxkLCBhcmcpIHtcbiAgICBpZiAodGFyZ2V0ICE9PSBPYmplY3QodGFyZ2V0KSkgeyAvLyBub3QgYW4gYXJyYXkgb3IgYW4gb2JqZWN0XG4gICAgICBjb25zdCBlcnJvciA9IE1pbmltb25nb0Vycm9yKFxuICAgICAgICAnQ2Fubm90IHNldCBwcm9wZXJ0eSBvbiBub24tb2JqZWN0IGZpZWxkJyxcbiAgICAgICAge2ZpZWxkfVxuICAgICAgKTtcbiAgICAgIGVycm9yLnNldFByb3BlcnR5RXJyb3IgPSB0cnVlO1xuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxuXG4gICAgaWYgKHRhcmdldCA9PT0gbnVsbCkge1xuICAgICAgY29uc3QgZXJyb3IgPSBNaW5pbW9uZ29FcnJvcignQ2Fubm90IHNldCBwcm9wZXJ0eSBvbiBudWxsJywge2ZpZWxkfSk7XG4gICAgICBlcnJvci5zZXRQcm9wZXJ0eUVycm9yID0gdHJ1ZTtcbiAgICAgIHRocm93IGVycm9yO1xuICAgIH1cblxuICAgIGFzc2VydEhhc1ZhbGlkRmllbGROYW1lcyhhcmcpO1xuXG4gICAgdGFyZ2V0W2ZpZWxkXSA9IGFyZztcbiAgfSxcbiAgJHNldE9uSW5zZXJ0KHRhcmdldCwgZmllbGQsIGFyZykge1xuICAgIC8vIGNvbnZlcnRlZCB0byBgJHNldGAgaW4gYF9tb2RpZnlgXG4gIH0sXG4gICR1bnNldCh0YXJnZXQsIGZpZWxkLCBhcmcpIHtcbiAgICBpZiAodGFyZ2V0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmICh0YXJnZXQgaW5zdGFuY2VvZiBBcnJheSkge1xuICAgICAgICBpZiAoZmllbGQgaW4gdGFyZ2V0KSB7XG4gICAgICAgICAgdGFyZ2V0W2ZpZWxkXSA9IG51bGw7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGRlbGV0ZSB0YXJnZXRbZmllbGRdO1xuICAgICAgfVxuICAgIH1cbiAgfSxcbiAgJHB1c2godGFyZ2V0LCBmaWVsZCwgYXJnKSB7XG4gICAgaWYgKHRhcmdldFtmaWVsZF0gPT09IHVuZGVmaW5lZCkge1xuICAgICAgdGFyZ2V0W2ZpZWxkXSA9IFtdO1xuICAgIH1cblxuICAgIGlmICghKHRhcmdldFtmaWVsZF0gaW5zdGFuY2VvZiBBcnJheSkpIHtcbiAgICAgIHRocm93IE1pbmltb25nb0Vycm9yKCdDYW5ub3QgYXBwbHkgJHB1c2ggbW9kaWZpZXIgdG8gbm9uLWFycmF5Jywge2ZpZWxkfSk7XG4gICAgfVxuXG4gICAgaWYgKCEoYXJnICYmIGFyZy4kZWFjaCkpIHtcbiAgICAgIC8vIFNpbXBsZSBtb2RlOiBub3QgJGVhY2hcbiAgICAgIGFzc2VydEhhc1ZhbGlkRmllbGROYW1lcyhhcmcpO1xuXG4gICAgICB0YXJnZXRbZmllbGRdLnB1c2goYXJnKTtcblxuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIEZhbmN5IG1vZGU6ICRlYWNoIChhbmQgbWF5YmUgJHNsaWNlIGFuZCAkc29ydCBhbmQgJHBvc2l0aW9uKVxuICAgIGNvbnN0IHRvUHVzaCA9IGFyZy4kZWFjaDtcbiAgICBpZiAoISh0b1B1c2ggaW5zdGFuY2VvZiBBcnJheSkpIHtcbiAgICAgIHRocm93IE1pbmltb25nb0Vycm9yKCckZWFjaCBtdXN0IGJlIGFuIGFycmF5Jywge2ZpZWxkfSk7XG4gICAgfVxuXG4gICAgYXNzZXJ0SGFzVmFsaWRGaWVsZE5hbWVzKHRvUHVzaCk7XG5cbiAgICAvLyBQYXJzZSAkcG9zaXRpb25cbiAgICBsZXQgcG9zaXRpb24gPSB1bmRlZmluZWQ7XG4gICAgaWYgKCckcG9zaXRpb24nIGluIGFyZykge1xuICAgICAgaWYgKHR5cGVvZiBhcmcuJHBvc2l0aW9uICE9PSAnbnVtYmVyJykge1xuICAgICAgICB0aHJvdyBNaW5pbW9uZ29FcnJvcignJHBvc2l0aW9uIG11c3QgYmUgYSBudW1lcmljIHZhbHVlJywge2ZpZWxkfSk7XG4gICAgICB9XG5cbiAgICAgIC8vIFhYWCBzaG91bGQgY2hlY2sgdG8gbWFrZSBzdXJlIGludGVnZXJcbiAgICAgIGlmIChhcmcuJHBvc2l0aW9uIDwgMCkge1xuICAgICAgICB0aHJvdyBNaW5pbW9uZ29FcnJvcihcbiAgICAgICAgICAnJHBvc2l0aW9uIGluICRwdXNoIG11c3QgYmUgemVybyBvciBwb3NpdGl2ZScsXG4gICAgICAgICAge2ZpZWxkfVxuICAgICAgICApO1xuICAgICAgfVxuXG4gICAgICBwb3NpdGlvbiA9IGFyZy4kcG9zaXRpb247XG4gICAgfVxuXG4gICAgLy8gUGFyc2UgJHNsaWNlLlxuICAgIGxldCBzbGljZSA9IHVuZGVmaW5lZDtcbiAgICBpZiAoJyRzbGljZScgaW4gYXJnKSB7XG4gICAgICBpZiAodHlwZW9mIGFyZy4kc2xpY2UgIT09ICdudW1iZXInKSB7XG4gICAgICAgIHRocm93IE1pbmltb25nb0Vycm9yKCckc2xpY2UgbXVzdCBiZSBhIG51bWVyaWMgdmFsdWUnLCB7ZmllbGR9KTtcbiAgICAgIH1cblxuICAgICAgLy8gWFhYIHNob3VsZCBjaGVjayB0byBtYWtlIHN1cmUgaW50ZWdlclxuICAgICAgc2xpY2UgPSBhcmcuJHNsaWNlO1xuICAgIH1cblxuICAgIC8vIFBhcnNlICRzb3J0LlxuICAgIGxldCBzb3J0RnVuY3Rpb24gPSB1bmRlZmluZWQ7XG4gICAgaWYgKGFyZy4kc29ydCkge1xuICAgICAgaWYgKHNsaWNlID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgdGhyb3cgTWluaW1vbmdvRXJyb3IoJyRzb3J0IHJlcXVpcmVzICRzbGljZSB0byBiZSBwcmVzZW50Jywge2ZpZWxkfSk7XG4gICAgICB9XG5cbiAgICAgIC8vIFhYWCB0aGlzIGFsbG93cyB1cyB0byB1c2UgYSAkc29ydCB3aG9zZSB2YWx1ZSBpcyBhbiBhcnJheSwgYnV0IHRoYXQnc1xuICAgICAgLy8gYWN0dWFsbHkgYW4gZXh0ZW5zaW9uIG9mIHRoZSBOb2RlIGRyaXZlciwgc28gaXQgd29uJ3Qgd29ya1xuICAgICAgLy8gc2VydmVyLXNpZGUuIENvdWxkIGJlIGNvbmZ1c2luZyFcbiAgICAgIC8vIFhYWCBpcyBpdCBjb3JyZWN0IHRoYXQgd2UgZG9uJ3QgZG8gZ2VvLXN0dWZmIGhlcmU/XG4gICAgICBzb3J0RnVuY3Rpb24gPSBuZXcgTWluaW1vbmdvLlNvcnRlcihhcmcuJHNvcnQpLmdldENvbXBhcmF0b3IoKTtcblxuICAgICAgdG9QdXNoLmZvckVhY2goZWxlbWVudCA9PiB7XG4gICAgICAgIGlmIChMb2NhbENvbGxlY3Rpb24uX2YuX3R5cGUoZWxlbWVudCkgIT09IDMpIHtcbiAgICAgICAgICB0aHJvdyBNaW5pbW9uZ29FcnJvcihcbiAgICAgICAgICAgICckcHVzaCBsaWtlIG1vZGlmaWVycyB1c2luZyAkc29ydCByZXF1aXJlIGFsbCBlbGVtZW50cyB0byBiZSAnICtcbiAgICAgICAgICAgICdvYmplY3RzJyxcbiAgICAgICAgICAgIHtmaWVsZH1cbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBBY3R1YWxseSBwdXNoLlxuICAgIGlmIChwb3NpdGlvbiA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICB0b1B1c2guZm9yRWFjaChlbGVtZW50ID0+IHtcbiAgICAgICAgdGFyZ2V0W2ZpZWxkXS5wdXNoKGVsZW1lbnQpO1xuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IHNwbGljZUFyZ3VtZW50cyA9IFtwb3NpdGlvbiwgMF07XG5cbiAgICAgIHRvUHVzaC5mb3JFYWNoKGVsZW1lbnQgPT4ge1xuICAgICAgICBzcGxpY2VBcmd1bWVudHMucHVzaChlbGVtZW50KTtcbiAgICAgIH0pO1xuXG4gICAgICB0YXJnZXRbZmllbGRdLnNwbGljZSguLi5zcGxpY2VBcmd1bWVudHMpO1xuICAgIH1cblxuICAgIC8vIEFjdHVhbGx5IHNvcnQuXG4gICAgaWYgKHNvcnRGdW5jdGlvbikge1xuICAgICAgdGFyZ2V0W2ZpZWxkXS5zb3J0KHNvcnRGdW5jdGlvbik7XG4gICAgfVxuXG4gICAgLy8gQWN0dWFsbHkgc2xpY2UuXG4gICAgaWYgKHNsaWNlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmIChzbGljZSA9PT0gMCkge1xuICAgICAgICB0YXJnZXRbZmllbGRdID0gW107IC8vIGRpZmZlcnMgZnJvbSBBcnJheS5zbGljZSFcbiAgICAgIH0gZWxzZSBpZiAoc2xpY2UgPCAwKSB7XG4gICAgICAgIHRhcmdldFtmaWVsZF0gPSB0YXJnZXRbZmllbGRdLnNsaWNlKHNsaWNlKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRhcmdldFtmaWVsZF0gPSB0YXJnZXRbZmllbGRdLnNsaWNlKDAsIHNsaWNlKTtcbiAgICAgIH1cbiAgICB9XG4gIH0sXG4gICRwdXNoQWxsKHRhcmdldCwgZmllbGQsIGFyZykge1xuICAgIGlmICghKHR5cGVvZiBhcmcgPT09ICdvYmplY3QnICYmIGFyZyBpbnN0YW5jZW9mIEFycmF5KSkge1xuICAgICAgdGhyb3cgTWluaW1vbmdvRXJyb3IoJ01vZGlmaWVyICRwdXNoQWxsL3B1bGxBbGwgYWxsb3dlZCBmb3IgYXJyYXlzIG9ubHknKTtcbiAgICB9XG5cbiAgICBhc3NlcnRIYXNWYWxpZEZpZWxkTmFtZXMoYXJnKTtcblxuICAgIGNvbnN0IHRvUHVzaCA9IHRhcmdldFtmaWVsZF07XG5cbiAgICBpZiAodG9QdXNoID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHRhcmdldFtmaWVsZF0gPSBhcmc7XG4gICAgfSBlbHNlIGlmICghKHRvUHVzaCBpbnN0YW5jZW9mIEFycmF5KSkge1xuICAgICAgdGhyb3cgTWluaW1vbmdvRXJyb3IoXG4gICAgICAgICdDYW5ub3QgYXBwbHkgJHB1c2hBbGwgbW9kaWZpZXIgdG8gbm9uLWFycmF5JyxcbiAgICAgICAge2ZpZWxkfVxuICAgICAgKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdG9QdXNoLnB1c2goLi4uYXJnKTtcbiAgICB9XG4gIH0sXG4gICRhZGRUb1NldCh0YXJnZXQsIGZpZWxkLCBhcmcpIHtcbiAgICBsZXQgaXNFYWNoID0gZmFsc2U7XG5cbiAgICBpZiAodHlwZW9mIGFyZyA9PT0gJ29iamVjdCcpIHtcbiAgICAgIC8vIGNoZWNrIGlmIGZpcnN0IGtleSBpcyAnJGVhY2gnXG4gICAgICBjb25zdCBrZXlzID0gT2JqZWN0LmtleXMoYXJnKTtcbiAgICAgIGlmIChrZXlzWzBdID09PSAnJGVhY2gnKSB7XG4gICAgICAgIGlzRWFjaCA9IHRydWU7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgdmFsdWVzID0gaXNFYWNoID8gYXJnLiRlYWNoIDogW2FyZ107XG5cbiAgICBhc3NlcnRIYXNWYWxpZEZpZWxkTmFtZXModmFsdWVzKTtcblxuICAgIGNvbnN0IHRvQWRkID0gdGFyZ2V0W2ZpZWxkXTtcbiAgICBpZiAodG9BZGQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgdGFyZ2V0W2ZpZWxkXSA9IHZhbHVlcztcbiAgICB9IGVsc2UgaWYgKCEodG9BZGQgaW5zdGFuY2VvZiBBcnJheSkpIHtcbiAgICAgIHRocm93IE1pbmltb25nb0Vycm9yKFxuICAgICAgICAnQ2Fubm90IGFwcGx5ICRhZGRUb1NldCBtb2RpZmllciB0byBub24tYXJyYXknLFxuICAgICAgICB7ZmllbGR9XG4gICAgICApO1xuICAgIH0gZWxzZSB7XG4gICAgICB2YWx1ZXMuZm9yRWFjaCh2YWx1ZSA9PiB7XG4gICAgICAgIGlmICh0b0FkZC5zb21lKGVsZW1lbnQgPT4gTG9jYWxDb2xsZWN0aW9uLl9mLl9lcXVhbCh2YWx1ZSwgZWxlbWVudCkpKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgdG9BZGQucHVzaCh2YWx1ZSk7XG4gICAgICB9KTtcbiAgICB9XG4gIH0sXG4gICRwb3AodGFyZ2V0LCBmaWVsZCwgYXJnKSB7XG4gICAgaWYgKHRhcmdldCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgdG9Qb3AgPSB0YXJnZXRbZmllbGRdO1xuXG4gICAgaWYgKHRvUG9wID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoISh0b1BvcCBpbnN0YW5jZW9mIEFycmF5KSkge1xuICAgICAgdGhyb3cgTWluaW1vbmdvRXJyb3IoJ0Nhbm5vdCBhcHBseSAkcG9wIG1vZGlmaWVyIHRvIG5vbi1hcnJheScsIHtmaWVsZH0pO1xuICAgIH1cblxuICAgIGlmICh0eXBlb2YgYXJnID09PSAnbnVtYmVyJyAmJiBhcmcgPCAwKSB7XG4gICAgICB0b1BvcC5zcGxpY2UoMCwgMSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRvUG9wLnBvcCgpO1xuICAgIH1cbiAgfSxcbiAgJHB1bGwodGFyZ2V0LCBmaWVsZCwgYXJnKSB7XG4gICAgaWYgKHRhcmdldCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgdG9QdWxsID0gdGFyZ2V0W2ZpZWxkXTtcbiAgICBpZiAodG9QdWxsID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoISh0b1B1bGwgaW5zdGFuY2VvZiBBcnJheSkpIHtcbiAgICAgIHRocm93IE1pbmltb25nb0Vycm9yKFxuICAgICAgICAnQ2Fubm90IGFwcGx5ICRwdWxsL3B1bGxBbGwgbW9kaWZpZXIgdG8gbm9uLWFycmF5JyxcbiAgICAgICAge2ZpZWxkfVxuICAgICAgKTtcbiAgICB9XG5cbiAgICBsZXQgb3V0O1xuICAgIGlmIChhcmcgIT0gbnVsbCAmJiB0eXBlb2YgYXJnID09PSAnb2JqZWN0JyAmJiAhKGFyZyBpbnN0YW5jZW9mIEFycmF5KSkge1xuICAgICAgLy8gWFhYIHdvdWxkIGJlIG11Y2ggbmljZXIgdG8gY29tcGlsZSB0aGlzIG9uY2UsIHJhdGhlciB0aGFuXG4gICAgICAvLyBmb3IgZWFjaCBkb2N1bWVudCB3ZSBtb2RpZnkuLiBidXQgdXN1YWxseSB3ZSdyZSBub3RcbiAgICAgIC8vIG1vZGlmeWluZyB0aGF0IG1hbnkgZG9jdW1lbnRzLCBzbyB3ZSdsbCBsZXQgaXQgc2xpZGUgZm9yXG4gICAgICAvLyBub3dcblxuICAgICAgLy8gWFhYIE1pbmltb25nby5NYXRjaGVyIGlzbid0IHVwIGZvciB0aGUgam9iLCBiZWNhdXNlIHdlIG5lZWRcbiAgICAgIC8vIHRvIHBlcm1pdCBzdHVmZiBsaWtlIHskcHVsbDoge2E6IHskZ3Q6IDR9fX0uLiBzb21ldGhpbmdcbiAgICAgIC8vIGxpa2UgeyRndDogNH0gaXMgbm90IG5vcm1hbGx5IGEgY29tcGxldGUgc2VsZWN0b3IuXG4gICAgICAvLyBzYW1lIGlzc3VlIGFzICRlbGVtTWF0Y2ggcG9zc2libHk/XG4gICAgICBjb25zdCBtYXRjaGVyID0gbmV3IE1pbmltb25nby5NYXRjaGVyKGFyZyk7XG5cbiAgICAgIG91dCA9IHRvUHVsbC5maWx0ZXIoZWxlbWVudCA9PiAhbWF0Y2hlci5kb2N1bWVudE1hdGNoZXMoZWxlbWVudCkucmVzdWx0KTtcbiAgICB9IGVsc2Uge1xuICAgICAgb3V0ID0gdG9QdWxsLmZpbHRlcihlbGVtZW50ID0+ICFMb2NhbENvbGxlY3Rpb24uX2YuX2VxdWFsKGVsZW1lbnQsIGFyZykpO1xuICAgIH1cblxuICAgIHRhcmdldFtmaWVsZF0gPSBvdXQ7XG4gIH0sXG4gICRwdWxsQWxsKHRhcmdldCwgZmllbGQsIGFyZykge1xuICAgIGlmICghKHR5cGVvZiBhcmcgPT09ICdvYmplY3QnICYmIGFyZyBpbnN0YW5jZW9mIEFycmF5KSkge1xuICAgICAgdGhyb3cgTWluaW1vbmdvRXJyb3IoXG4gICAgICAgICdNb2RpZmllciAkcHVzaEFsbC9wdWxsQWxsIGFsbG93ZWQgZm9yIGFycmF5cyBvbmx5JyxcbiAgICAgICAge2ZpZWxkfVxuICAgICAgKTtcbiAgICB9XG5cbiAgICBpZiAodGFyZ2V0ID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCB0b1B1bGwgPSB0YXJnZXRbZmllbGRdO1xuXG4gICAgaWYgKHRvUHVsbCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKCEodG9QdWxsIGluc3RhbmNlb2YgQXJyYXkpKSB7XG4gICAgICB0aHJvdyBNaW5pbW9uZ29FcnJvcihcbiAgICAgICAgJ0Nhbm5vdCBhcHBseSAkcHVsbC9wdWxsQWxsIG1vZGlmaWVyIHRvIG5vbi1hcnJheScsXG4gICAgICAgIHtmaWVsZH1cbiAgICAgICk7XG4gICAgfVxuXG4gICAgdGFyZ2V0W2ZpZWxkXSA9IHRvUHVsbC5maWx0ZXIob2JqZWN0ID0+XG4gICAgICAhYXJnLnNvbWUoZWxlbWVudCA9PiBMb2NhbENvbGxlY3Rpb24uX2YuX2VxdWFsKG9iamVjdCwgZWxlbWVudCkpXG4gICAgKTtcbiAgfSxcbiAgJHJlbmFtZSh0YXJnZXQsIGZpZWxkLCBhcmcsIGtleXBhdGgsIGRvYykge1xuICAgIC8vIG5vIGlkZWEgd2h5IG1vbmdvIGhhcyB0aGlzIHJlc3RyaWN0aW9uLi5cbiAgICBpZiAoa2V5cGF0aCA9PT0gYXJnKSB7XG4gICAgICB0aHJvdyBNaW5pbW9uZ29FcnJvcignJHJlbmFtZSBzb3VyY2UgbXVzdCBkaWZmZXIgZnJvbSB0YXJnZXQnLCB7ZmllbGR9KTtcbiAgICB9XG5cbiAgICBpZiAodGFyZ2V0ID09PSBudWxsKSB7XG4gICAgICB0aHJvdyBNaW5pbW9uZ29FcnJvcignJHJlbmFtZSBzb3VyY2UgZmllbGQgaW52YWxpZCcsIHtmaWVsZH0pO1xuICAgIH1cblxuICAgIGlmICh0eXBlb2YgYXJnICE9PSAnc3RyaW5nJykge1xuICAgICAgdGhyb3cgTWluaW1vbmdvRXJyb3IoJyRyZW5hbWUgdGFyZ2V0IG11c3QgYmUgYSBzdHJpbmcnLCB7ZmllbGR9KTtcbiAgICB9XG5cbiAgICBpZiAoYXJnLmluY2x1ZGVzKCdcXDAnKSkge1xuICAgICAgLy8gTnVsbCBieXRlcyBhcmUgbm90IGFsbG93ZWQgaW4gTW9uZ28gZmllbGQgbmFtZXNcbiAgICAgIC8vIGh0dHBzOi8vZG9jcy5tb25nb2RiLmNvbS9tYW51YWwvcmVmZXJlbmNlL2xpbWl0cy8jUmVzdHJpY3Rpb25zLW9uLUZpZWxkLU5hbWVzXG4gICAgICB0aHJvdyBNaW5pbW9uZ29FcnJvcihcbiAgICAgICAgJ1RoZSBcXCd0b1xcJyBmaWVsZCBmb3IgJHJlbmFtZSBjYW5ub3QgY29udGFpbiBhbiBlbWJlZGRlZCBudWxsIGJ5dGUnLFxuICAgICAgICB7ZmllbGR9XG4gICAgICApO1xuICAgIH1cblxuICAgIGlmICh0YXJnZXQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IG9iamVjdCA9IHRhcmdldFtmaWVsZF07XG5cbiAgICBkZWxldGUgdGFyZ2V0W2ZpZWxkXTtcblxuICAgIGNvbnN0IGtleXBhcnRzID0gYXJnLnNwbGl0KCcuJyk7XG4gICAgY29uc3QgdGFyZ2V0MiA9IGZpbmRNb2RUYXJnZXQoZG9jLCBrZXlwYXJ0cywge2ZvcmJpZEFycmF5OiB0cnVlfSk7XG5cbiAgICBpZiAodGFyZ2V0MiA9PT0gbnVsbCkge1xuICAgICAgdGhyb3cgTWluaW1vbmdvRXJyb3IoJyRyZW5hbWUgdGFyZ2V0IGZpZWxkIGludmFsaWQnLCB7ZmllbGR9KTtcbiAgICB9XG5cbiAgICB0YXJnZXQyW2tleXBhcnRzLnBvcCgpXSA9IG9iamVjdDtcbiAgfSxcbiAgJGJpdCh0YXJnZXQsIGZpZWxkLCBhcmcpIHtcbiAgICAvLyBYWFggbW9uZ28gb25seSBzdXBwb3J0cyAkYml0IG9uIGludGVnZXJzLCBhbmQgd2Ugb25seSBzdXBwb3J0XG4gICAgLy8gbmF0aXZlIGphdmFzY3JpcHQgbnVtYmVycyAoZG91Ymxlcykgc28gZmFyLCBzbyB3ZSBjYW4ndCBzdXBwb3J0ICRiaXRcbiAgICB0aHJvdyBNaW5pbW9uZ29FcnJvcignJGJpdCBpcyBub3Qgc3VwcG9ydGVkJywge2ZpZWxkfSk7XG4gIH0sXG59O1xuXG5jb25zdCBOT19DUkVBVEVfTU9ESUZJRVJTID0ge1xuICAkcG9wOiB0cnVlLFxuICAkcHVsbDogdHJ1ZSxcbiAgJHB1bGxBbGw6IHRydWUsXG4gICRyZW5hbWU6IHRydWUsXG4gICR1bnNldDogdHJ1ZVxufTtcblxuLy8gTWFrZSBzdXJlIGZpZWxkIG5hbWVzIGRvIG5vdCBjb250YWluIE1vbmdvIHJlc3RyaWN0ZWRcbi8vIGNoYXJhY3RlcnMgKCcuJywgJyQnLCAnXFwwJykuXG4vLyBodHRwczovL2RvY3MubW9uZ29kYi5jb20vbWFudWFsL3JlZmVyZW5jZS9saW1pdHMvI1Jlc3RyaWN0aW9ucy1vbi1GaWVsZC1OYW1lc1xuY29uc3QgaW52YWxpZENoYXJNc2cgPSB7XG4gICQ6ICdzdGFydCB3aXRoIFxcJyRcXCcnLFxuICAnLic6ICdjb250YWluIFxcJy5cXCcnLFxuICAnXFwwJzogJ2NvbnRhaW4gbnVsbCBieXRlcydcbn07XG5cbi8vIGNoZWNrcyBpZiBhbGwgZmllbGQgbmFtZXMgaW4gYW4gb2JqZWN0IGFyZSB2YWxpZFxuZnVuY3Rpb24gYXNzZXJ0SGFzVmFsaWRGaWVsZE5hbWVzKGRvYykge1xuICBpZiAoZG9jICYmIHR5cGVvZiBkb2MgPT09ICdvYmplY3QnKSB7XG4gICAgSlNPTi5zdHJpbmdpZnkoZG9jLCAoa2V5LCB2YWx1ZSkgPT4ge1xuICAgICAgYXNzZXJ0SXNWYWxpZEZpZWxkTmFtZShrZXkpO1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH0pO1xuICB9XG59XG5cbmZ1bmN0aW9uIGFzc2VydElzVmFsaWRGaWVsZE5hbWUoa2V5KSB7XG4gIGxldCBtYXRjaDtcbiAgaWYgKHR5cGVvZiBrZXkgPT09ICdzdHJpbmcnICYmIChtYXRjaCA9IGtleS5tYXRjaCgvXlxcJHxcXC58XFwwLykpKSB7XG4gICAgdGhyb3cgTWluaW1vbmdvRXJyb3IoYEtleSAke2tleX0gbXVzdCBub3QgJHtpbnZhbGlkQ2hhck1zZ1ttYXRjaFswXV19YCk7XG4gIH1cbn1cblxuLy8gZm9yIGEuYi5jLjIuZC5lLCBrZXlwYXJ0cyBzaG91bGQgYmUgWydhJywgJ2InLCAnYycsICcyJywgJ2QnLCAnZSddLFxuLy8gYW5kIHRoZW4geW91IHdvdWxkIG9wZXJhdGUgb24gdGhlICdlJyBwcm9wZXJ0eSBvZiB0aGUgcmV0dXJuZWRcbi8vIG9iamVjdC5cbi8vXG4vLyBpZiBvcHRpb25zLm5vQ3JlYXRlIGlzIGZhbHNleSwgY3JlYXRlcyBpbnRlcm1lZGlhdGUgbGV2ZWxzIG9mXG4vLyBzdHJ1Y3R1cmUgYXMgbmVjZXNzYXJ5LCBsaWtlIG1rZGlyIC1wIChhbmQgcmFpc2VzIGFuIGV4Y2VwdGlvbiBpZlxuLy8gdGhhdCB3b3VsZCBtZWFuIGdpdmluZyBhIG5vbi1udW1lcmljIHByb3BlcnR5IHRvIGFuIGFycmF5LikgaWZcbi8vIG9wdGlvbnMubm9DcmVhdGUgaXMgdHJ1ZSwgcmV0dXJuIHVuZGVmaW5lZCBpbnN0ZWFkLlxuLy9cbi8vIG1heSBtb2RpZnkgdGhlIGxhc3QgZWxlbWVudCBvZiBrZXlwYXJ0cyB0byBzaWduYWwgdG8gdGhlIGNhbGxlciB0aGF0IGl0IG5lZWRzXG4vLyB0byB1c2UgYSBkaWZmZXJlbnQgdmFsdWUgdG8gaW5kZXggaW50byB0aGUgcmV0dXJuZWQgb2JqZWN0IChmb3IgZXhhbXBsZSxcbi8vIFsnYScsICcwMSddIC0+IFsnYScsIDFdKS5cbi8vXG4vLyBpZiBmb3JiaWRBcnJheSBpcyB0cnVlLCByZXR1cm4gbnVsbCBpZiB0aGUga2V5cGF0aCBnb2VzIHRocm91Z2ggYW4gYXJyYXkuXG4vL1xuLy8gaWYgb3B0aW9ucy5hcnJheUluZGljZXMgaXMgc2V0LCB1c2UgaXRzIGZpcnN0IGVsZW1lbnQgZm9yIHRoZSAoZmlyc3QpICckJyBpblxuLy8gdGhlIHBhdGguXG5mdW5jdGlvbiBmaW5kTW9kVGFyZ2V0KGRvYywga2V5cGFydHMsIG9wdGlvbnMgPSB7fSkge1xuICBsZXQgdXNlZEFycmF5SW5kZXggPSBmYWxzZTtcblxuICBmb3IgKGxldCBpID0gMDsgaSA8IGtleXBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgbGFzdCA9IGkgPT09IGtleXBhcnRzLmxlbmd0aCAtIDE7XG4gICAgbGV0IGtleXBhcnQgPSBrZXlwYXJ0c1tpXTtcblxuICAgIGlmICghaXNJbmRleGFibGUoZG9jKSkge1xuICAgICAgaWYgKG9wdGlvbnMubm9DcmVhdGUpIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIH1cblxuICAgICAgY29uc3QgZXJyb3IgPSBNaW5pbW9uZ29FcnJvcihcbiAgICAgICAgYGNhbm5vdCB1c2UgdGhlIHBhcnQgJyR7a2V5cGFydH0nIHRvIHRyYXZlcnNlICR7ZG9jfWBcbiAgICAgICk7XG4gICAgICBlcnJvci5zZXRQcm9wZXJ0eUVycm9yID0gdHJ1ZTtcbiAgICAgIHRocm93IGVycm9yO1xuICAgIH1cblxuICAgIGlmIChkb2MgaW5zdGFuY2VvZiBBcnJheSkge1xuICAgICAgaWYgKG9wdGlvbnMuZm9yYmlkQXJyYXkpIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG5cbiAgICAgIGlmIChrZXlwYXJ0ID09PSAnJCcpIHtcbiAgICAgICAgaWYgKHVzZWRBcnJheUluZGV4KSB7XG4gICAgICAgICAgdGhyb3cgTWluaW1vbmdvRXJyb3IoJ1RvbyBtYW55IHBvc2l0aW9uYWwgKGkuZS4gXFwnJFxcJykgZWxlbWVudHMnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghb3B0aW9ucy5hcnJheUluZGljZXMgfHwgIW9wdGlvbnMuYXJyYXlJbmRpY2VzLmxlbmd0aCkge1xuICAgICAgICAgIHRocm93IE1pbmltb25nb0Vycm9yKFxuICAgICAgICAgICAgJ1RoZSBwb3NpdGlvbmFsIG9wZXJhdG9yIGRpZCBub3QgZmluZCB0aGUgbWF0Y2ggbmVlZGVkIGZyb20gdGhlICcgK1xuICAgICAgICAgICAgJ3F1ZXJ5J1xuICAgICAgICAgICk7XG4gICAgICAgIH1cblxuICAgICAgICBrZXlwYXJ0ID0gb3B0aW9ucy5hcnJheUluZGljZXNbMF07XG4gICAgICAgIHVzZWRBcnJheUluZGV4ID0gdHJ1ZTtcbiAgICAgIH0gZWxzZSBpZiAoaXNOdW1lcmljS2V5KGtleXBhcnQpKSB7XG4gICAgICAgIGtleXBhcnQgPSBwYXJzZUludChrZXlwYXJ0KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmIChvcHRpb25zLm5vQ3JlYXRlKSB7XG4gICAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgICAgfVxuXG4gICAgICAgIHRocm93IE1pbmltb25nb0Vycm9yKFxuICAgICAgICAgIGBjYW4ndCBhcHBlbmQgdG8gYXJyYXkgdXNpbmcgc3RyaW5nIGZpZWxkIG5hbWUgWyR7a2V5cGFydH1dYFxuICAgICAgICApO1xuICAgICAgfVxuXG4gICAgICBpZiAobGFzdCkge1xuICAgICAgICBrZXlwYXJ0c1tpXSA9IGtleXBhcnQ7IC8vIGhhbmRsZSAnYS4wMSdcbiAgICAgIH1cblxuICAgICAgaWYgKG9wdGlvbnMubm9DcmVhdGUgJiYga2V5cGFydCA+PSBkb2MubGVuZ3RoKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIHdoaWxlIChkb2MubGVuZ3RoIDwga2V5cGFydCkge1xuICAgICAgICBkb2MucHVzaChudWxsKTtcbiAgICAgIH1cblxuICAgICAgaWYgKCFsYXN0KSB7XG4gICAgICAgIGlmIChkb2MubGVuZ3RoID09PSBrZXlwYXJ0KSB7XG4gICAgICAgICAgZG9jLnB1c2goe30pO1xuICAgICAgICB9IGVsc2UgaWYgKHR5cGVvZiBkb2Nba2V5cGFydF0gIT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgdGhyb3cgTWluaW1vbmdvRXJyb3IoXG4gICAgICAgICAgICBgY2FuJ3QgbW9kaWZ5IGZpZWxkICcke2tleXBhcnRzW2kgKyAxXX0nIG9mIGxpc3QgdmFsdWUgYCArXG4gICAgICAgICAgICBKU09OLnN0cmluZ2lmeShkb2Nba2V5cGFydF0pXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBhc3NlcnRJc1ZhbGlkRmllbGROYW1lKGtleXBhcnQpO1xuXG4gICAgICBpZiAoIShrZXlwYXJ0IGluIGRvYykpIHtcbiAgICAgICAgaWYgKG9wdGlvbnMubm9DcmVhdGUpIHtcbiAgICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFsYXN0KSB7XG4gICAgICAgICAgZG9jW2tleXBhcnRdID0ge307XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAobGFzdCkge1xuICAgICAgcmV0dXJuIGRvYztcbiAgICB9XG5cbiAgICBkb2MgPSBkb2Nba2V5cGFydF07XG4gIH1cblxuICAvLyBub3RyZWFjaGVkXG59XG4iLCJpbXBvcnQgTG9jYWxDb2xsZWN0aW9uIGZyb20gJy4vbG9jYWxfY29sbGVjdGlvbi5qcyc7XG5pbXBvcnQge1xuICBjb21waWxlRG9jdW1lbnRTZWxlY3RvcixcbiAgaGFzT3duLFxuICBub3RoaW5nTWF0Y2hlcixcbn0gZnJvbSAnLi9jb21tb24uanMnO1xuXG4vLyBUaGUgbWluaW1vbmdvIHNlbGVjdG9yIGNvbXBpbGVyIVxuXG4vLyBUZXJtaW5vbG9neTpcbi8vICAtIGEgJ3NlbGVjdG9yJyBpcyB0aGUgRUpTT04gb2JqZWN0IHJlcHJlc2VudGluZyBhIHNlbGVjdG9yXG4vLyAgLSBhICdtYXRjaGVyJyBpcyBpdHMgY29tcGlsZWQgZm9ybSAod2hldGhlciBhIGZ1bGwgTWluaW1vbmdvLk1hdGNoZXJcbi8vICAgIG9iamVjdCBvciBvbmUgb2YgdGhlIGNvbXBvbmVudCBsYW1iZGFzIHRoYXQgbWF0Y2hlcyBwYXJ0cyBvZiBpdClcbi8vICAtIGEgJ3Jlc3VsdCBvYmplY3QnIGlzIGFuIG9iamVjdCB3aXRoIGEgJ3Jlc3VsdCcgZmllbGQgYW5kIG1heWJlXG4vLyAgICBkaXN0YW5jZSBhbmQgYXJyYXlJbmRpY2VzLlxuLy8gIC0gYSAnYnJhbmNoZWQgdmFsdWUnIGlzIGFuIG9iamVjdCB3aXRoIGEgJ3ZhbHVlJyBmaWVsZCBhbmQgbWF5YmVcbi8vICAgICdkb250SXRlcmF0ZScgYW5kICdhcnJheUluZGljZXMnLlxuLy8gIC0gYSAnZG9jdW1lbnQnIGlzIGEgdG9wLWxldmVsIG9iamVjdCB0aGF0IGNhbiBiZSBzdG9yZWQgaW4gYSBjb2xsZWN0aW9uLlxuLy8gIC0gYSAnbG9va3VwIGZ1bmN0aW9uJyBpcyBhIGZ1bmN0aW9uIHRoYXQgdGFrZXMgaW4gYSBkb2N1bWVudCBhbmQgcmV0dXJuc1xuLy8gICAgYW4gYXJyYXkgb2YgJ2JyYW5jaGVkIHZhbHVlcycuXG4vLyAgLSBhICdicmFuY2hlZCBtYXRjaGVyJyBtYXBzIGZyb20gYW4gYXJyYXkgb2YgYnJhbmNoZWQgdmFsdWVzIHRvIGEgcmVzdWx0XG4vLyAgICBvYmplY3QuXG4vLyAgLSBhbiAnZWxlbWVudCBtYXRjaGVyJyBtYXBzIGZyb20gYSBzaW5nbGUgdmFsdWUgdG8gYSBib29sLlxuXG4vLyBNYWluIGVudHJ5IHBvaW50LlxuLy8gICB2YXIgbWF0Y2hlciA9IG5ldyBNaW5pbW9uZ28uTWF0Y2hlcih7YTogeyRndDogNX19KTtcbi8vICAgaWYgKG1hdGNoZXIuZG9jdW1lbnRNYXRjaGVzKHthOiA3fSkpIC4uLlxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgTWF0Y2hlciB7XG4gIGNvbnN0cnVjdG9yKHNlbGVjdG9yLCBpc1VwZGF0ZSkge1xuICAgIC8vIEEgc2V0IChvYmplY3QgbWFwcGluZyBzdHJpbmcgLT4gKikgb2YgYWxsIG9mIHRoZSBkb2N1bWVudCBwYXRocyBsb29rZWRcbiAgICAvLyBhdCBieSB0aGUgc2VsZWN0b3IuIEFsc28gaW5jbHVkZXMgdGhlIGVtcHR5IHN0cmluZyBpZiBpdCBtYXkgbG9vayBhdCBhbnlcbiAgICAvLyBwYXRoIChlZywgJHdoZXJlKS5cbiAgICB0aGlzLl9wYXRocyA9IHt9O1xuICAgIC8vIFNldCB0byB0cnVlIGlmIGNvbXBpbGF0aW9uIGZpbmRzIGEgJG5lYXIuXG4gICAgdGhpcy5faGFzR2VvUXVlcnkgPSBmYWxzZTtcbiAgICAvLyBTZXQgdG8gdHJ1ZSBpZiBjb21waWxhdGlvbiBmaW5kcyBhICR3aGVyZS5cbiAgICB0aGlzLl9oYXNXaGVyZSA9IGZhbHNlO1xuICAgIC8vIFNldCB0byBmYWxzZSBpZiBjb21waWxhdGlvbiBmaW5kcyBhbnl0aGluZyBvdGhlciB0aGFuIGEgc2ltcGxlIGVxdWFsaXR5XG4gICAgLy8gb3Igb25lIG9yIG1vcmUgb2YgJyRndCcsICckZ3RlJywgJyRsdCcsICckbHRlJywgJyRuZScsICckaW4nLCAnJG5pbicgdXNlZFxuICAgIC8vIHdpdGggc2NhbGFycyBhcyBvcGVyYW5kcy5cbiAgICB0aGlzLl9pc1NpbXBsZSA9IHRydWU7XG4gICAgLy8gU2V0IHRvIGEgZHVtbXkgZG9jdW1lbnQgd2hpY2ggYWx3YXlzIG1hdGNoZXMgdGhpcyBNYXRjaGVyLiBPciBzZXQgdG8gbnVsbFxuICAgIC8vIGlmIHN1Y2ggZG9jdW1lbnQgaXMgdG9vIGhhcmQgdG8gZmluZC5cbiAgICB0aGlzLl9tYXRjaGluZ0RvY3VtZW50ID0gdW5kZWZpbmVkO1xuICAgIC8vIEEgY2xvbmUgb2YgdGhlIG9yaWdpbmFsIHNlbGVjdG9yLiBJdCBtYXkganVzdCBiZSBhIGZ1bmN0aW9uIGlmIHRoZSB1c2VyXG4gICAgLy8gcGFzc2VkIGluIGEgZnVuY3Rpb247IG90aGVyd2lzZSBpcyBkZWZpbml0ZWx5IGFuIG9iamVjdCAoZWcsIElEcyBhcmVcbiAgICAvLyB0cmFuc2xhdGVkIGludG8ge19pZDogSUR9IGZpcnN0LiBVc2VkIGJ5IGNhbkJlY29tZVRydWVCeU1vZGlmaWVyIGFuZFxuICAgIC8vIFNvcnRlci5fdXNlV2l0aE1hdGNoZXIuXG4gICAgdGhpcy5fc2VsZWN0b3IgPSBudWxsO1xuICAgIHRoaXMuX2RvY01hdGNoZXIgPSB0aGlzLl9jb21waWxlU2VsZWN0b3Ioc2VsZWN0b3IpO1xuICAgIC8vIFNldCB0byB0cnVlIGlmIHNlbGVjdGlvbiBpcyBkb25lIGZvciBhbiB1cGRhdGUgb3BlcmF0aW9uXG4gICAgLy8gRGVmYXVsdCBpcyBmYWxzZVxuICAgIC8vIFVzZWQgZm9yICRuZWFyIGFycmF5IHVwZGF0ZSAoaXNzdWUgIzM1OTkpXG4gICAgdGhpcy5faXNVcGRhdGUgPSBpc1VwZGF0ZTtcbiAgfVxuXG4gIGRvY3VtZW50TWF0Y2hlcyhkb2MpIHtcbiAgICBpZiAoZG9jICE9PSBPYmplY3QoZG9jKSkge1xuICAgICAgdGhyb3cgRXJyb3IoJ2RvY3VtZW50TWF0Y2hlcyBuZWVkcyBhIGRvY3VtZW50Jyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2RvY01hdGNoZXIoZG9jKTtcbiAgfVxuXG4gIGhhc0dlb1F1ZXJ5KCkge1xuICAgIHJldHVybiB0aGlzLl9oYXNHZW9RdWVyeTtcbiAgfVxuXG4gIGhhc1doZXJlKCkge1xuICAgIHJldHVybiB0aGlzLl9oYXNXaGVyZTtcbiAgfVxuXG4gIGlzU2ltcGxlKCkge1xuICAgIHJldHVybiB0aGlzLl9pc1NpbXBsZTtcbiAgfVxuXG4gIC8vIEdpdmVuIGEgc2VsZWN0b3IsIHJldHVybiBhIGZ1bmN0aW9uIHRoYXQgdGFrZXMgb25lIGFyZ3VtZW50LCBhXG4gIC8vIGRvY3VtZW50LiBJdCByZXR1cm5zIGEgcmVzdWx0IG9iamVjdC5cbiAgX2NvbXBpbGVTZWxlY3RvcihzZWxlY3Rvcikge1xuICAgIC8vIHlvdSBjYW4gcGFzcyBhIGxpdGVyYWwgZnVuY3Rpb24gaW5zdGVhZCBvZiBhIHNlbGVjdG9yXG4gICAgaWYgKHNlbGVjdG9yIGluc3RhbmNlb2YgRnVuY3Rpb24pIHtcbiAgICAgIHRoaXMuX2lzU2ltcGxlID0gZmFsc2U7XG4gICAgICB0aGlzLl9zZWxlY3RvciA9IHNlbGVjdG9yO1xuICAgICAgdGhpcy5fcmVjb3JkUGF0aFVzZWQoJycpO1xuXG4gICAgICByZXR1cm4gZG9jID0+ICh7cmVzdWx0OiAhIXNlbGVjdG9yLmNhbGwoZG9jKX0pO1xuICAgIH1cblxuICAgIC8vIHNob3J0aGFuZCAtLSBzY2FsYXIgX2lkXG4gICAgaWYgKExvY2FsQ29sbGVjdGlvbi5fc2VsZWN0b3JJc0lkKHNlbGVjdG9yKSkge1xuICAgICAgdGhpcy5fc2VsZWN0b3IgPSB7X2lkOiBzZWxlY3Rvcn07XG4gICAgICB0aGlzLl9yZWNvcmRQYXRoVXNlZCgnX2lkJyk7XG5cbiAgICAgIHJldHVybiBkb2MgPT4gKHtyZXN1bHQ6IEVKU09OLmVxdWFscyhkb2MuX2lkLCBzZWxlY3Rvcil9KTtcbiAgICB9XG5cbiAgICAvLyBwcm90ZWN0IGFnYWluc3QgZGFuZ2Vyb3VzIHNlbGVjdG9ycy4gIGZhbHNleSBhbmQge19pZDogZmFsc2V5fSBhcmUgYm90aFxuICAgIC8vIGxpa2VseSBwcm9ncmFtbWVyIGVycm9yLCBhbmQgbm90IHdoYXQgeW91IHdhbnQsIHBhcnRpY3VsYXJseSBmb3JcbiAgICAvLyBkZXN0cnVjdGl2ZSBvcGVyYXRpb25zLlxuICAgIGlmICghc2VsZWN0b3IgfHwgaGFzT3duLmNhbGwoc2VsZWN0b3IsICdfaWQnKSAmJiAhc2VsZWN0b3IuX2lkKSB7XG4gICAgICB0aGlzLl9pc1NpbXBsZSA9IGZhbHNlO1xuICAgICAgcmV0dXJuIG5vdGhpbmdNYXRjaGVyO1xuICAgIH1cblxuICAgIC8vIFRvcCBsZXZlbCBjYW4ndCBiZSBhbiBhcnJheSBvciB0cnVlIG9yIGJpbmFyeS5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShzZWxlY3RvcikgfHxcbiAgICAgICAgRUpTT04uaXNCaW5hcnkoc2VsZWN0b3IpIHx8XG4gICAgICAgIHR5cGVvZiBzZWxlY3RvciA9PT0gJ2Jvb2xlYW4nKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgc2VsZWN0b3I6ICR7c2VsZWN0b3J9YCk7XG4gICAgfVxuXG4gICAgdGhpcy5fc2VsZWN0b3IgPSBFSlNPTi5jbG9uZShzZWxlY3Rvcik7XG5cbiAgICByZXR1cm4gY29tcGlsZURvY3VtZW50U2VsZWN0b3Ioc2VsZWN0b3IsIHRoaXMsIHtpc1Jvb3Q6IHRydWV9KTtcbiAgfVxuXG4gIC8vIFJldHVybnMgYSBsaXN0IG9mIGtleSBwYXRocyB0aGUgZ2l2ZW4gc2VsZWN0b3IgaXMgbG9va2luZyBmb3IuIEl0IGluY2x1ZGVzXG4gIC8vIHRoZSBlbXB0eSBzdHJpbmcgaWYgdGhlcmUgaXMgYSAkd2hlcmUuXG4gIF9nZXRQYXRocygpIHtcbiAgICByZXR1cm4gT2JqZWN0LmtleXModGhpcy5fcGF0aHMpO1xuICB9XG5cbiAgX3JlY29yZFBhdGhVc2VkKHBhdGgpIHtcbiAgICB0aGlzLl9wYXRoc1twYXRoXSA9IHRydWU7XG4gIH1cbn1cblxuLy8gaGVscGVycyB1c2VkIGJ5IGNvbXBpbGVkIHNlbGVjdG9yIGNvZGVcbkxvY2FsQ29sbGVjdGlvbi5fZiA9IHtcbiAgLy8gWFhYIGZvciBfYWxsIGFuZCBfaW4sIGNvbnNpZGVyIGJ1aWxkaW5nICdpbnF1ZXJ5JyBhdCBjb21waWxlIHRpbWUuLlxuICBfdHlwZSh2KSB7XG4gICAgaWYgKHR5cGVvZiB2ID09PSAnbnVtYmVyJykge1xuICAgICAgcmV0dXJuIDE7XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiB2ID09PSAnc3RyaW5nJykge1xuICAgICAgcmV0dXJuIDI7XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiB2ID09PSAnYm9vbGVhbicpIHtcbiAgICAgIHJldHVybiA4O1xuICAgIH1cblxuICAgIGlmIChBcnJheS5pc0FycmF5KHYpKSB7XG4gICAgICByZXR1cm4gNDtcbiAgICB9XG5cbiAgICBpZiAodiA9PT0gbnVsbCkge1xuICAgICAgcmV0dXJuIDEwO1xuICAgIH1cblxuICAgIC8vIG5vdGUgdGhhdCB0eXBlb2YoL3gvKSA9PT0gXCJvYmplY3RcIlxuICAgIGlmICh2IGluc3RhbmNlb2YgUmVnRXhwKSB7XG4gICAgICByZXR1cm4gMTE7XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiB2ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICByZXR1cm4gMTM7XG4gICAgfVxuXG4gICAgaWYgKHYgaW5zdGFuY2VvZiBEYXRlKSB7XG4gICAgICByZXR1cm4gOTtcbiAgICB9XG5cbiAgICBpZiAoRUpTT04uaXNCaW5hcnkodikpIHtcbiAgICAgIHJldHVybiA1O1xuICAgIH1cblxuICAgIGlmICh2IGluc3RhbmNlb2YgTW9uZ29JRC5PYmplY3RJRCkge1xuICAgICAgcmV0dXJuIDc7XG4gICAgfVxuXG4gICAgLy8gb2JqZWN0XG4gICAgcmV0dXJuIDM7XG5cbiAgICAvLyBYWFggc3VwcG9ydCBzb21lL2FsbCBvZiB0aGVzZTpcbiAgICAvLyAxNCwgc3ltYm9sXG4gICAgLy8gMTUsIGphdmFzY3JpcHQgY29kZSB3aXRoIHNjb3BlXG4gICAgLy8gMTYsIDE4OiAzMi1iaXQvNjQtYml0IGludGVnZXJcbiAgICAvLyAxNywgdGltZXN0YW1wXG4gICAgLy8gMjU1LCBtaW5rZXlcbiAgICAvLyAxMjcsIG1heGtleVxuICB9LFxuXG4gIC8vIGRlZXAgZXF1YWxpdHkgdGVzdDogdXNlIGZvciBsaXRlcmFsIGRvY3VtZW50IGFuZCBhcnJheSBtYXRjaGVzXG4gIF9lcXVhbChhLCBiKSB7XG4gICAgcmV0dXJuIEVKU09OLmVxdWFscyhhLCBiLCB7a2V5T3JkZXJTZW5zaXRpdmU6IHRydWV9KTtcbiAgfSxcblxuICAvLyBtYXBzIGEgdHlwZSBjb2RlIHRvIGEgdmFsdWUgdGhhdCBjYW4gYmUgdXNlZCB0byBzb3J0IHZhbHVlcyBvZiBkaWZmZXJlbnRcbiAgLy8gdHlwZXNcbiAgX3R5cGVvcmRlcih0KSB7XG4gICAgLy8gaHR0cDovL3d3dy5tb25nb2RiLm9yZy9kaXNwbGF5L0RPQ1MvV2hhdCtpcyt0aGUrQ29tcGFyZStPcmRlcitmb3IrQlNPTitUeXBlc1xuICAgIC8vIFhYWCB3aGF0IGlzIHRoZSBjb3JyZWN0IHNvcnQgcG9zaXRpb24gZm9yIEphdmFzY3JpcHQgY29kZT9cbiAgICAvLyAoJzEwMCcgaW4gdGhlIG1hdHJpeCBiZWxvdylcbiAgICAvLyBYWFggbWlua2V5L21heGtleVxuICAgIHJldHVybiBbXG4gICAgICAtMSwgIC8vIChub3QgYSB0eXBlKVxuICAgICAgMSwgICAvLyBudW1iZXJcbiAgICAgIDIsICAgLy8gc3RyaW5nXG4gICAgICAzLCAgIC8vIG9iamVjdFxuICAgICAgNCwgICAvLyBhcnJheVxuICAgICAgNSwgICAvLyBiaW5hcnlcbiAgICAgIC0xLCAgLy8gZGVwcmVjYXRlZFxuICAgICAgNiwgICAvLyBPYmplY3RJRFxuICAgICAgNywgICAvLyBib29sXG4gICAgICA4LCAgIC8vIERhdGVcbiAgICAgIDAsICAgLy8gbnVsbFxuICAgICAgOSwgICAvLyBSZWdFeHBcbiAgICAgIC0xLCAgLy8gZGVwcmVjYXRlZFxuICAgICAgMTAwLCAvLyBKUyBjb2RlXG4gICAgICAyLCAgIC8vIGRlcHJlY2F0ZWQgKHN5bWJvbClcbiAgICAgIDEwMCwgLy8gSlMgY29kZVxuICAgICAgMSwgICAvLyAzMi1iaXQgaW50XG4gICAgICA4LCAgIC8vIE1vbmdvIHRpbWVzdGFtcFxuICAgICAgMSAgICAvLyA2NC1iaXQgaW50XG4gICAgXVt0XTtcbiAgfSxcblxuICAvLyBjb21wYXJlIHR3byB2YWx1ZXMgb2YgdW5rbm93biB0eXBlIGFjY29yZGluZyB0byBCU09OIG9yZGVyaW5nXG4gIC8vIHNlbWFudGljcy4gKGFzIGFuIGV4dGVuc2lvbiwgY29uc2lkZXIgJ3VuZGVmaW5lZCcgdG8gYmUgbGVzcyB0aGFuXG4gIC8vIGFueSBvdGhlciB2YWx1ZS4pIHJldHVybiBuZWdhdGl2ZSBpZiBhIGlzIGxlc3MsIHBvc2l0aXZlIGlmIGIgaXNcbiAgLy8gbGVzcywgb3IgMCBpZiBlcXVhbFxuICBfY21wKGEsIGIpIHtcbiAgICBpZiAoYSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXR1cm4gYiA9PT0gdW5kZWZpbmVkID8gMCA6IC0xO1xuICAgIH1cblxuICAgIGlmIChiID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHJldHVybiAxO1xuICAgIH1cblxuICAgIGxldCB0YSA9IExvY2FsQ29sbGVjdGlvbi5fZi5fdHlwZShhKTtcbiAgICBsZXQgdGIgPSBMb2NhbENvbGxlY3Rpb24uX2YuX3R5cGUoYik7XG5cbiAgICBjb25zdCBvYSA9IExvY2FsQ29sbGVjdGlvbi5fZi5fdHlwZW9yZGVyKHRhKTtcbiAgICBjb25zdCBvYiA9IExvY2FsQ29sbGVjdGlvbi5fZi5fdHlwZW9yZGVyKHRiKTtcblxuICAgIGlmIChvYSAhPT0gb2IpIHtcbiAgICAgIHJldHVybiBvYSA8IG9iID8gLTEgOiAxO1xuICAgIH1cblxuICAgIC8vIFhYWCBuZWVkIHRvIGltcGxlbWVudCB0aGlzIGlmIHdlIGltcGxlbWVudCBTeW1ib2wgb3IgaW50ZWdlcnMsIG9yXG4gICAgLy8gVGltZXN0YW1wXG4gICAgaWYgKHRhICE9PSB0Yikge1xuICAgICAgdGhyb3cgRXJyb3IoJ01pc3NpbmcgdHlwZSBjb2VyY2lvbiBsb2dpYyBpbiBfY21wJyk7XG4gICAgfVxuXG4gICAgaWYgKHRhID09PSA3KSB7IC8vIE9iamVjdElEXG4gICAgICAvLyBDb252ZXJ0IHRvIHN0cmluZy5cbiAgICAgIHRhID0gdGIgPSAyO1xuICAgICAgYSA9IGEudG9IZXhTdHJpbmcoKTtcbiAgICAgIGIgPSBiLnRvSGV4U3RyaW5nKCk7XG4gICAgfVxuXG4gICAgaWYgKHRhID09PSA5KSB7IC8vIERhdGVcbiAgICAgIC8vIENvbnZlcnQgdG8gbWlsbGlzLlxuICAgICAgdGEgPSB0YiA9IDE7XG4gICAgICBhID0gYS5nZXRUaW1lKCk7XG4gICAgICBiID0gYi5nZXRUaW1lKCk7XG4gICAgfVxuXG4gICAgaWYgKHRhID09PSAxKSAvLyBkb3VibGVcbiAgICAgIHJldHVybiBhIC0gYjtcblxuICAgIGlmICh0YiA9PT0gMikgLy8gc3RyaW5nXG4gICAgICByZXR1cm4gYSA8IGIgPyAtMSA6IGEgPT09IGIgPyAwIDogMTtcblxuICAgIGlmICh0YSA9PT0gMykgeyAvLyBPYmplY3RcbiAgICAgIC8vIHRoaXMgY291bGQgYmUgbXVjaCBtb3JlIGVmZmljaWVudCBpbiB0aGUgZXhwZWN0ZWQgY2FzZSAuLi5cbiAgICAgIGNvbnN0IHRvQXJyYXkgPSBvYmplY3QgPT4ge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBbXTtcblxuICAgICAgICBPYmplY3Qua2V5cyhvYmplY3QpLmZvckVhY2goa2V5ID0+IHtcbiAgICAgICAgICByZXN1bHQucHVzaChrZXksIG9iamVjdFtrZXldKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgIH07XG5cbiAgICAgIHJldHVybiBMb2NhbENvbGxlY3Rpb24uX2YuX2NtcCh0b0FycmF5KGEpLCB0b0FycmF5KGIpKTtcbiAgICB9XG5cbiAgICBpZiAodGEgPT09IDQpIHsgLy8gQXJyYXlcbiAgICAgIGZvciAobGV0IGkgPSAwOyA7IGkrKykge1xuICAgICAgICBpZiAoaSA9PT0gYS5sZW5ndGgpIHtcbiAgICAgICAgICByZXR1cm4gaSA9PT0gYi5sZW5ndGggPyAwIDogLTE7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaSA9PT0gYi5sZW5ndGgpIHtcbiAgICAgICAgICByZXR1cm4gMTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHMgPSBMb2NhbENvbGxlY3Rpb24uX2YuX2NtcChhW2ldLCBiW2ldKTtcbiAgICAgICAgaWYgKHMgIT09IDApIHtcbiAgICAgICAgICByZXR1cm4gcztcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh0YSA9PT0gNSkgeyAvLyBiaW5hcnlcbiAgICAgIC8vIFN1cnByaXNpbmdseSwgYSBzbWFsbCBiaW5hcnkgYmxvYiBpcyBhbHdheXMgbGVzcyB0aGFuIGEgbGFyZ2Ugb25lIGluXG4gICAgICAvLyBNb25nby5cbiAgICAgIGlmIChhLmxlbmd0aCAhPT0gYi5sZW5ndGgpIHtcbiAgICAgICAgcmV0dXJuIGEubGVuZ3RoIC0gYi5sZW5ndGg7XG4gICAgICB9XG5cbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgYS5sZW5ndGg7IGkrKykge1xuICAgICAgICBpZiAoYVtpXSA8IGJbaV0pIHtcbiAgICAgICAgICByZXR1cm4gLTE7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoYVtpXSA+IGJbaV0pIHtcbiAgICAgICAgICByZXR1cm4gMTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gMDtcbiAgICB9XG5cbiAgICBpZiAodGEgPT09IDgpIHsgLy8gYm9vbGVhblxuICAgICAgaWYgKGEpIHtcbiAgICAgICAgcmV0dXJuIGIgPyAwIDogMTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGIgPyAtMSA6IDA7XG4gICAgfVxuXG4gICAgaWYgKHRhID09PSAxMCkgLy8gbnVsbFxuICAgICAgcmV0dXJuIDA7XG5cbiAgICBpZiAodGEgPT09IDExKSAvLyByZWdleHBcbiAgICAgIHRocm93IEVycm9yKCdTb3J0aW5nIG5vdCBzdXBwb3J0ZWQgb24gcmVndWxhciBleHByZXNzaW9uJyk7IC8vIFhYWFxuXG4gICAgLy8gMTM6IGphdmFzY3JpcHQgY29kZVxuICAgIC8vIDE0OiBzeW1ib2xcbiAgICAvLyAxNTogamF2YXNjcmlwdCBjb2RlIHdpdGggc2NvcGVcbiAgICAvLyAxNjogMzItYml0IGludGVnZXJcbiAgICAvLyAxNzogdGltZXN0YW1wXG4gICAgLy8gMTg6IDY0LWJpdCBpbnRlZ2VyXG4gICAgLy8gMjU1OiBtaW5rZXlcbiAgICAvLyAxMjc6IG1heGtleVxuICAgIGlmICh0YSA9PT0gMTMpIC8vIGphdmFzY3JpcHQgY29kZVxuICAgICAgdGhyb3cgRXJyb3IoJ1NvcnRpbmcgbm90IHN1cHBvcnRlZCBvbiBKYXZhc2NyaXB0IGNvZGUnKTsgLy8gWFhYXG5cbiAgICB0aHJvdyBFcnJvcignVW5rbm93biB0eXBlIHRvIHNvcnQnKTtcbiAgfSxcbn07XG4iLCJpbXBvcnQgTG9jYWxDb2xsZWN0aW9uXyBmcm9tICcuL2xvY2FsX2NvbGxlY3Rpb24uanMnO1xuaW1wb3J0IE1hdGNoZXIgZnJvbSAnLi9tYXRjaGVyLmpzJztcbmltcG9ydCBTb3J0ZXIgZnJvbSAnLi9zb3J0ZXIuanMnO1xuXG5Mb2NhbENvbGxlY3Rpb24gPSBMb2NhbENvbGxlY3Rpb25fO1xuTWluaW1vbmdvID0ge1xuICAgIExvY2FsQ29sbGVjdGlvbjogTG9jYWxDb2xsZWN0aW9uXyxcbiAgICBNYXRjaGVyLFxuICAgIFNvcnRlclxufTtcbiIsIi8vIE9ic2VydmVIYW5kbGU6IHRoZSByZXR1cm4gdmFsdWUgb2YgYSBsaXZlIHF1ZXJ5LlxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgT2JzZXJ2ZUhhbmRsZSB7fVxuIiwiaW1wb3J0IHtcbiAgRUxFTUVOVF9PUEVSQVRPUlMsXG4gIGVxdWFsaXR5RWxlbWVudE1hdGNoZXIsXG4gIGV4cGFuZEFycmF5c0luQnJhbmNoZXMsXG4gIGhhc093bixcbiAgaXNPcGVyYXRvck9iamVjdCxcbiAgbWFrZUxvb2t1cEZ1bmN0aW9uLFxuICByZWdleHBFbGVtZW50TWF0Y2hlcixcbn0gZnJvbSAnLi9jb21tb24uanMnO1xuXG4vLyBHaXZlIGEgc29ydCBzcGVjLCB3aGljaCBjYW4gYmUgaW4gYW55IG9mIHRoZXNlIGZvcm1zOlxuLy8gICB7XCJrZXkxXCI6IDEsIFwia2V5MlwiOiAtMX1cbi8vICAgW1tcImtleTFcIiwgXCJhc2NcIl0sIFtcImtleTJcIiwgXCJkZXNjXCJdXVxuLy8gICBbXCJrZXkxXCIsIFtcImtleTJcIiwgXCJkZXNjXCJdXVxuLy9cbi8vICguLiB3aXRoIHRoZSBmaXJzdCBmb3JtIGJlaW5nIGRlcGVuZGVudCBvbiB0aGUga2V5IGVudW1lcmF0aW9uXG4vLyBiZWhhdmlvciBvZiB5b3VyIGphdmFzY3JpcHQgVk0sIHdoaWNoIHVzdWFsbHkgZG9lcyB3aGF0IHlvdSBtZWFuIGluXG4vLyB0aGlzIGNhc2UgaWYgdGhlIGtleSBuYW1lcyBkb24ndCBsb29rIGxpa2UgaW50ZWdlcnMgLi4pXG4vL1xuLy8gcmV0dXJuIGEgZnVuY3Rpb24gdGhhdCB0YWtlcyB0d28gb2JqZWN0cywgYW5kIHJldHVybnMgLTEgaWYgdGhlXG4vLyBmaXJzdCBvYmplY3QgY29tZXMgZmlyc3QgaW4gb3JkZXIsIDEgaWYgdGhlIHNlY29uZCBvYmplY3QgY29tZXNcbi8vIGZpcnN0LCBvciAwIGlmIG5laXRoZXIgb2JqZWN0IGNvbWVzIGJlZm9yZSB0aGUgb3RoZXIuXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFNvcnRlciB7XG4gIGNvbnN0cnVjdG9yKHNwZWMsIG9wdGlvbnMgPSB7fSkge1xuICAgIHRoaXMuX3NvcnRTcGVjUGFydHMgPSBbXTtcbiAgICB0aGlzLl9zb3J0RnVuY3Rpb24gPSBudWxsO1xuXG4gICAgY29uc3QgYWRkU3BlY1BhcnQgPSAocGF0aCwgYXNjZW5kaW5nKSA9PiB7XG4gICAgICBpZiAoIXBhdGgpIHtcbiAgICAgICAgdGhyb3cgRXJyb3IoJ3NvcnQga2V5cyBtdXN0IGJlIG5vbi1lbXB0eScpO1xuICAgICAgfVxuXG4gICAgICBpZiAocGF0aC5jaGFyQXQoMCkgPT09ICckJykge1xuICAgICAgICB0aHJvdyBFcnJvcihgdW5zdXBwb3J0ZWQgc29ydCBrZXk6ICR7cGF0aH1gKTtcbiAgICAgIH1cblxuICAgICAgdGhpcy5fc29ydFNwZWNQYXJ0cy5wdXNoKHtcbiAgICAgICAgYXNjZW5kaW5nLFxuICAgICAgICBsb29rdXA6IG1ha2VMb29rdXBGdW5jdGlvbihwYXRoLCB7Zm9yU29ydDogdHJ1ZX0pLFxuICAgICAgICBwYXRoXG4gICAgICB9KTtcbiAgICB9O1xuXG4gICAgaWYgKHNwZWMgaW5zdGFuY2VvZiBBcnJheSkge1xuICAgICAgc3BlYy5mb3JFYWNoKGVsZW1lbnQgPT4ge1xuICAgICAgICBpZiAodHlwZW9mIGVsZW1lbnQgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgYWRkU3BlY1BhcnQoZWxlbWVudCwgdHJ1ZSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgYWRkU3BlY1BhcnQoZWxlbWVudFswXSwgZWxlbWVudFsxXSAhPT0gJ2Rlc2MnKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSBlbHNlIGlmICh0eXBlb2Ygc3BlYyA9PT0gJ29iamVjdCcpIHtcbiAgICAgIE9iamVjdC5rZXlzKHNwZWMpLmZvckVhY2goa2V5ID0+IHtcbiAgICAgICAgYWRkU3BlY1BhcnQoa2V5LCBzcGVjW2tleV0gPj0gMCk7XG4gICAgICB9KTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBzcGVjID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICB0aGlzLl9zb3J0RnVuY3Rpb24gPSBzcGVjO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBFcnJvcihgQmFkIHNvcnQgc3BlY2lmaWNhdGlvbjogJHtKU09OLnN0cmluZ2lmeShzcGVjKX1gKTtcbiAgICB9XG5cbiAgICAvLyBJZiBhIGZ1bmN0aW9uIGlzIHNwZWNpZmllZCBmb3Igc29ydGluZywgd2Ugc2tpcCB0aGUgcmVzdC5cbiAgICBpZiAodGhpcy5fc29ydEZ1bmN0aW9uKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gVG8gaW1wbGVtZW50IGFmZmVjdGVkQnlNb2RpZmllciwgd2UgcGlnZ3ktYmFjayBvbiB0b3Agb2YgTWF0Y2hlcidzXG4gICAgLy8gYWZmZWN0ZWRCeU1vZGlmaWVyIGNvZGU7IHdlIGNyZWF0ZSBhIHNlbGVjdG9yIHRoYXQgaXMgYWZmZWN0ZWQgYnkgdGhlXG4gICAgLy8gc2FtZSBtb2RpZmllcnMgYXMgdGhpcyBzb3J0IG9yZGVyLiBUaGlzIGlzIG9ubHkgaW1wbGVtZW50ZWQgb24gdGhlXG4gICAgLy8gc2VydmVyLlxuICAgIGlmICh0aGlzLmFmZmVjdGVkQnlNb2RpZmllcikge1xuICAgICAgY29uc3Qgc2VsZWN0b3IgPSB7fTtcblxuICAgICAgdGhpcy5fc29ydFNwZWNQYXJ0cy5mb3JFYWNoKHNwZWMgPT4ge1xuICAgICAgICBzZWxlY3RvcltzcGVjLnBhdGhdID0gMTtcbiAgICAgIH0pO1xuXG4gICAgICB0aGlzLl9zZWxlY3RvckZvckFmZmVjdGVkQnlNb2RpZmllciA9IG5ldyBNaW5pbW9uZ28uTWF0Y2hlcihzZWxlY3Rvcik7XG4gICAgfVxuXG4gICAgdGhpcy5fa2V5Q29tcGFyYXRvciA9IGNvbXBvc2VDb21wYXJhdG9ycyhcbiAgICAgIHRoaXMuX3NvcnRTcGVjUGFydHMubWFwKChzcGVjLCBpKSA9PiB0aGlzLl9rZXlGaWVsZENvbXBhcmF0b3IoaSkpXG4gICAgKTtcblxuICAgIC8vIElmIHlvdSBzcGVjaWZ5IGEgbWF0Y2hlciBmb3IgdGhpcyBTb3J0ZXIsIF9rZXlGaWx0ZXIgbWF5IGJlIHNldCB0byBhXG4gICAgLy8gZnVuY3Rpb24gd2hpY2ggc2VsZWN0cyB3aGV0aGVyIG9yIG5vdCBhIGdpdmVuIFwic29ydCBrZXlcIiAodHVwbGUgb2YgdmFsdWVzXG4gICAgLy8gZm9yIHRoZSBkaWZmZXJlbnQgc29ydCBzcGVjIGZpZWxkcykgaXMgY29tcGF0aWJsZSB3aXRoIHRoZSBzZWxlY3Rvci5cbiAgICB0aGlzLl9rZXlGaWx0ZXIgPSBudWxsO1xuXG4gICAgaWYgKG9wdGlvbnMubWF0Y2hlcikge1xuICAgICAgdGhpcy5fdXNlV2l0aE1hdGNoZXIob3B0aW9ucy5tYXRjaGVyKTtcbiAgICB9XG4gIH1cblxuICBnZXRDb21wYXJhdG9yKG9wdGlvbnMpIHtcbiAgICAvLyBJZiBzb3J0IGlzIHNwZWNpZmllZCBvciBoYXZlIG5vIGRpc3RhbmNlcywganVzdCB1c2UgdGhlIGNvbXBhcmF0b3IgZnJvbVxuICAgIC8vIHRoZSBzb3VyY2Ugc3BlY2lmaWNhdGlvbiAod2hpY2ggZGVmYXVsdHMgdG8gXCJldmVyeXRoaW5nIGlzIGVxdWFsXCIuXG4gICAgLy8gaXNzdWUgIzM1OTlcbiAgICAvLyBodHRwczovL2RvY3MubW9uZ29kYi5jb20vbWFudWFsL3JlZmVyZW5jZS9vcGVyYXRvci9xdWVyeS9uZWFyLyNzb3J0LW9wZXJhdGlvblxuICAgIC8vIHNvcnQgZWZmZWN0aXZlbHkgb3ZlcnJpZGVzICRuZWFyXG4gICAgaWYgKHRoaXMuX3NvcnRTcGVjUGFydHMubGVuZ3RoIHx8ICFvcHRpb25zIHx8ICFvcHRpb25zLmRpc3RhbmNlcykge1xuICAgICAgcmV0dXJuIHRoaXMuX2dldEJhc2VDb21wYXJhdG9yKCk7XG4gICAgfVxuXG4gICAgY29uc3QgZGlzdGFuY2VzID0gb3B0aW9ucy5kaXN0YW5jZXM7XG5cbiAgICAvLyBSZXR1cm4gYSBjb21wYXJhdG9yIHdoaWNoIGNvbXBhcmVzIHVzaW5nICRuZWFyIGRpc3RhbmNlcy5cbiAgICByZXR1cm4gKGEsIGIpID0+IHtcbiAgICAgIGlmICghZGlzdGFuY2VzLmhhcyhhLl9pZCkpIHtcbiAgICAgICAgdGhyb3cgRXJyb3IoYE1pc3NpbmcgZGlzdGFuY2UgZm9yICR7YS5faWR9YCk7XG4gICAgICB9XG5cbiAgICAgIGlmICghZGlzdGFuY2VzLmhhcyhiLl9pZCkpIHtcbiAgICAgICAgdGhyb3cgRXJyb3IoYE1pc3NpbmcgZGlzdGFuY2UgZm9yICR7Yi5faWR9YCk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBkaXN0YW5jZXMuZ2V0KGEuX2lkKSAtIGRpc3RhbmNlcy5nZXQoYi5faWQpO1xuICAgIH07XG4gIH1cblxuICAvLyBUYWtlcyBpbiB0d28ga2V5czogYXJyYXlzIHdob3NlIGxlbmd0aHMgbWF0Y2ggdGhlIG51bWJlciBvZiBzcGVjXG4gIC8vIHBhcnRzLiBSZXR1cm5zIG5lZ2F0aXZlLCAwLCBvciBwb3NpdGl2ZSBiYXNlZCBvbiB1c2luZyB0aGUgc29ydCBzcGVjIHRvXG4gIC8vIGNvbXBhcmUgZmllbGRzLlxuICBfY29tcGFyZUtleXMoa2V5MSwga2V5Mikge1xuICAgIGlmIChrZXkxLmxlbmd0aCAhPT0gdGhpcy5fc29ydFNwZWNQYXJ0cy5sZW5ndGggfHxcbiAgICAgICAga2V5Mi5sZW5ndGggIT09IHRoaXMuX3NvcnRTcGVjUGFydHMubGVuZ3RoKSB7XG4gICAgICB0aHJvdyBFcnJvcignS2V5IGhhcyB3cm9uZyBsZW5ndGgnKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fa2V5Q29tcGFyYXRvcihrZXkxLCBrZXkyKTtcbiAgfVxuXG4gIC8vIEl0ZXJhdGVzIG92ZXIgZWFjaCBwb3NzaWJsZSBcImtleVwiIGZyb20gZG9jIChpZSwgb3ZlciBlYWNoIGJyYW5jaCksIGNhbGxpbmdcbiAgLy8gJ2NiJyB3aXRoIHRoZSBrZXkuXG4gIF9nZW5lcmF0ZUtleXNGcm9tRG9jKGRvYywgY2IpIHtcbiAgICBpZiAodGhpcy5fc29ydFNwZWNQYXJ0cy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignY2FuXFwndCBnZW5lcmF0ZSBrZXlzIHdpdGhvdXQgYSBzcGVjJyk7XG4gICAgfVxuXG4gICAgY29uc3QgcGF0aEZyb21JbmRpY2VzID0gaW5kaWNlcyA9PiBgJHtpbmRpY2VzLmpvaW4oJywnKX0sYDtcblxuICAgIGxldCBrbm93blBhdGhzID0gbnVsbDtcblxuICAgIC8vIG1hcHMgaW5kZXggLT4gKHsnJyAtPiB2YWx1ZX0gb3Ige3BhdGggLT4gdmFsdWV9KVxuICAgIGNvbnN0IHZhbHVlc0J5SW5kZXhBbmRQYXRoID0gdGhpcy5fc29ydFNwZWNQYXJ0cy5tYXAoc3BlYyA9PiB7XG4gICAgICAvLyBFeHBhbmQgYW55IGxlYWYgYXJyYXlzIHRoYXQgd2UgZmluZCwgYW5kIGlnbm9yZSB0aG9zZSBhcnJheXNcbiAgICAgIC8vIHRoZW1zZWx2ZXMuICAoV2UgbmV2ZXIgc29ydCBiYXNlZCBvbiBhbiBhcnJheSBpdHNlbGYuKVxuICAgICAgbGV0IGJyYW5jaGVzID0gZXhwYW5kQXJyYXlzSW5CcmFuY2hlcyhzcGVjLmxvb2t1cChkb2MpLCB0cnVlKTtcblxuICAgICAgLy8gSWYgdGhlcmUgYXJlIG5vIHZhbHVlcyBmb3IgYSBrZXkgKGVnLCBrZXkgZ29lcyB0byBhbiBlbXB0eSBhcnJheSksXG4gICAgICAvLyBwcmV0ZW5kIHdlIGZvdW5kIG9uZSBudWxsIHZhbHVlLlxuICAgICAgaWYgKCFicmFuY2hlcy5sZW5ndGgpIHtcbiAgICAgICAgYnJhbmNoZXMgPSBbe3ZhbHVlOiBudWxsfV07XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGVsZW1lbnQgPSBPYmplY3QuY3JlYXRlKG51bGwpO1xuICAgICAgbGV0IHVzZWRQYXRocyA9IGZhbHNlO1xuXG4gICAgICBicmFuY2hlcy5mb3JFYWNoKGJyYW5jaCA9PiB7XG4gICAgICAgIGlmICghYnJhbmNoLmFycmF5SW5kaWNlcykge1xuICAgICAgICAgIC8vIElmIHRoZXJlIGFyZSBubyBhcnJheSBpbmRpY2VzIGZvciBhIGJyYW5jaCwgdGhlbiBpdCBtdXN0IGJlIHRoZVxuICAgICAgICAgIC8vIG9ubHkgYnJhbmNoLCBiZWNhdXNlIHRoZSBvbmx5IHRoaW5nIHRoYXQgcHJvZHVjZXMgbXVsdGlwbGUgYnJhbmNoZXNcbiAgICAgICAgICAvLyBpcyB0aGUgdXNlIG9mIGFycmF5cy5cbiAgICAgICAgICBpZiAoYnJhbmNoZXMubGVuZ3RoID4gMSkge1xuICAgICAgICAgICAgdGhyb3cgRXJyb3IoJ211bHRpcGxlIGJyYW5jaGVzIGJ1dCBubyBhcnJheSB1c2VkPycpO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGVsZW1lbnRbJyddID0gYnJhbmNoLnZhbHVlO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHVzZWRQYXRocyA9IHRydWU7XG5cbiAgICAgICAgY29uc3QgcGF0aCA9IHBhdGhGcm9tSW5kaWNlcyhicmFuY2guYXJyYXlJbmRpY2VzKTtcblxuICAgICAgICBpZiAoaGFzT3duLmNhbGwoZWxlbWVudCwgcGF0aCkpIHtcbiAgICAgICAgICB0aHJvdyBFcnJvcihgZHVwbGljYXRlIHBhdGg6ICR7cGF0aH1gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGVsZW1lbnRbcGF0aF0gPSBicmFuY2gudmFsdWU7XG5cbiAgICAgICAgLy8gSWYgdHdvIHNvcnQgZmllbGRzIGJvdGggZ28gaW50byBhcnJheXMsIHRoZXkgaGF2ZSB0byBnbyBpbnRvIHRoZVxuICAgICAgICAvLyBleGFjdCBzYW1lIGFycmF5cyBhbmQgd2UgaGF2ZSB0byBmaW5kIHRoZSBzYW1lIHBhdGhzLiAgVGhpcyBpc1xuICAgICAgICAvLyByb3VnaGx5IHRoZSBzYW1lIGNvbmRpdGlvbiB0aGF0IG1ha2VzIE1vbmdvREIgdGhyb3cgdGhpcyBzdHJhbmdlXG4gICAgICAgIC8vIGVycm9yIG1lc3NhZ2UuICBlZywgdGhlIG1haW4gdGhpbmcgaXMgdGhhdCBpZiBzb3J0IHNwZWMgaXMge2E6IDEsXG4gICAgICAgIC8vIGI6MX0gdGhlbiBhIGFuZCBiIGNhbm5vdCBib3RoIGJlIGFycmF5cy5cbiAgICAgICAgLy9cbiAgICAgICAgLy8gKEluIE1vbmdvREIgaXQgc2VlbXMgdG8gYmUgT0sgdG8gaGF2ZSB7YTogMSwgJ2EueC55JzogMX0gd2hlcmUgJ2EnXG4gICAgICAgIC8vIGFuZCAnYS54LnknIGFyZSBib3RoIGFycmF5cywgYnV0IHdlIGRvbid0IGFsbG93IHRoaXMgZm9yIG5vdy5cbiAgICAgICAgLy8gI05lc3RlZEFycmF5U29ydFxuICAgICAgICAvLyBYWFggYWNoaWV2ZSBmdWxsIGNvbXBhdGliaWxpdHkgaGVyZVxuICAgICAgICBpZiAoa25vd25QYXRocyAmJiAhaGFzT3duLmNhbGwoa25vd25QYXRocywgcGF0aCkpIHtcbiAgICAgICAgICB0aHJvdyBFcnJvcignY2Fubm90IGluZGV4IHBhcmFsbGVsIGFycmF5cycpO1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgaWYgKGtub3duUGF0aHMpIHtcbiAgICAgICAgLy8gU2ltaWxhcmx5IHRvIGFib3ZlLCBwYXRocyBtdXN0IG1hdGNoIGV2ZXJ5d2hlcmUsIHVubGVzcyB0aGlzIGlzIGFcbiAgICAgICAgLy8gbm9uLWFycmF5IGZpZWxkLlxuICAgICAgICBpZiAoIWhhc093bi5jYWxsKGVsZW1lbnQsICcnKSAmJlxuICAgICAgICAgICAgT2JqZWN0LmtleXMoa25vd25QYXRocykubGVuZ3RoICE9PSBPYmplY3Qua2V5cyhlbGVtZW50KS5sZW5ndGgpIHtcbiAgICAgICAgICB0aHJvdyBFcnJvcignY2Fubm90IGluZGV4IHBhcmFsbGVsIGFycmF5cyEnKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmICh1c2VkUGF0aHMpIHtcbiAgICAgICAga25vd25QYXRocyA9IHt9O1xuXG4gICAgICAgIE9iamVjdC5rZXlzKGVsZW1lbnQpLmZvckVhY2gocGF0aCA9PiB7XG4gICAgICAgICAga25vd25QYXRoc1twYXRoXSA9IHRydWU7XG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gZWxlbWVudDtcbiAgICB9KTtcblxuICAgIGlmICgha25vd25QYXRocykge1xuICAgICAgLy8gRWFzeSBjYXNlOiBubyB1c2Ugb2YgYXJyYXlzLlxuICAgICAgY29uc3Qgc29sZUtleSA9IHZhbHVlc0J5SW5kZXhBbmRQYXRoLm1hcCh2YWx1ZXMgPT4ge1xuICAgICAgICBpZiAoIWhhc093bi5jYWxsKHZhbHVlcywgJycpKSB7XG4gICAgICAgICAgdGhyb3cgRXJyb3IoJ25vIHZhbHVlIGluIHNvbGUga2V5IGNhc2U/Jyk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdmFsdWVzWycnXTtcbiAgICAgIH0pO1xuXG4gICAgICBjYihzb2xlS2V5KTtcblxuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIE9iamVjdC5rZXlzKGtub3duUGF0aHMpLmZvckVhY2gocGF0aCA9PiB7XG4gICAgICBjb25zdCBrZXkgPSB2YWx1ZXNCeUluZGV4QW5kUGF0aC5tYXAodmFsdWVzID0+IHtcbiAgICAgICAgaWYgKGhhc093bi5jYWxsKHZhbHVlcywgJycpKSB7XG4gICAgICAgICAgcmV0dXJuIHZhbHVlc1snJ107XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIWhhc093bi5jYWxsKHZhbHVlcywgcGF0aCkpIHtcbiAgICAgICAgICB0aHJvdyBFcnJvcignbWlzc2luZyBwYXRoPycpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHZhbHVlc1twYXRoXTtcbiAgICAgIH0pO1xuXG4gICAgICBjYihrZXkpO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gUmV0dXJucyBhIGNvbXBhcmF0b3IgdGhhdCByZXByZXNlbnRzIHRoZSBzb3J0IHNwZWNpZmljYXRpb24gKGJ1dCBub3RcbiAgLy8gaW5jbHVkaW5nIGEgcG9zc2libGUgZ2VvcXVlcnkgZGlzdGFuY2UgdGllLWJyZWFrZXIpLlxuICBfZ2V0QmFzZUNvbXBhcmF0b3IoKSB7XG4gICAgaWYgKHRoaXMuX3NvcnRGdW5jdGlvbikge1xuICAgICAgcmV0dXJuIHRoaXMuX3NvcnRGdW5jdGlvbjtcbiAgICB9XG5cbiAgICAvLyBJZiB3ZSdyZSBvbmx5IHNvcnRpbmcgb24gZ2VvcXVlcnkgZGlzdGFuY2UgYW5kIG5vIHNwZWNzLCBqdXN0IHNheVxuICAgIC8vIGV2ZXJ5dGhpbmcgaXMgZXF1YWwuXG4gICAgaWYgKCF0aGlzLl9zb3J0U3BlY1BhcnRzLmxlbmd0aCkge1xuICAgICAgcmV0dXJuIChkb2MxLCBkb2MyKSA9PiAwO1xuICAgIH1cblxuICAgIHJldHVybiAoZG9jMSwgZG9jMikgPT4ge1xuICAgICAgY29uc3Qga2V5MSA9IHRoaXMuX2dldE1pbktleUZyb21Eb2MoZG9jMSk7XG4gICAgICBjb25zdCBrZXkyID0gdGhpcy5fZ2V0TWluS2V5RnJvbURvYyhkb2MyKTtcbiAgICAgIHJldHVybiB0aGlzLl9jb21wYXJlS2V5cyhrZXkxLCBrZXkyKTtcbiAgICB9O1xuICB9XG5cbiAgLy8gRmluZHMgdGhlIG1pbmltdW0ga2V5IGZyb20gdGhlIGRvYywgYWNjb3JkaW5nIHRvIHRoZSBzb3J0IHNwZWNzLiAgKFdlIHNheVxuICAvLyBcIm1pbmltdW1cIiBoZXJlIGJ1dCB0aGlzIGlzIHdpdGggcmVzcGVjdCB0byB0aGUgc29ydCBzcGVjLCBzbyBcImRlc2NlbmRpbmdcIlxuICAvLyBzb3J0IGZpZWxkcyBtZWFuIHdlJ3JlIGZpbmRpbmcgdGhlIG1heCBmb3IgdGhhdCBmaWVsZC4pXG4gIC8vXG4gIC8vIE5vdGUgdGhhdCB0aGlzIGlzIE5PVCBcImZpbmQgdGhlIG1pbmltdW0gdmFsdWUgb2YgdGhlIGZpcnN0IGZpZWxkLCB0aGVcbiAgLy8gbWluaW11bSB2YWx1ZSBvZiB0aGUgc2Vjb25kIGZpZWxkLCBldGNcIi4uLiBpdCdzIFwiY2hvb3NlIHRoZVxuICAvLyBsZXhpY29ncmFwaGljYWxseSBtaW5pbXVtIHZhbHVlIG9mIHRoZSBrZXkgdmVjdG9yLCBhbGxvd2luZyBvbmx5IGtleXMgd2hpY2hcbiAgLy8geW91IGNhbiBmaW5kIGFsb25nIHRoZSBzYW1lIHBhdGhzXCIuICBpZSwgZm9yIGEgZG9jIHthOiBbe3g6IDAsIHk6IDV9LCB7eDpcbiAgLy8gMSwgeTogM31dfSB3aXRoIHNvcnQgc3BlYyB7J2EueCc6IDEsICdhLnknOiAxfSwgdGhlIG9ubHkga2V5cyBhcmUgWzAsNV0gYW5kXG4gIC8vIFsxLDNdLCBhbmQgdGhlIG1pbmltdW0ga2V5IGlzIFswLDVdOyBub3RhYmx5LCBbMCwzXSBpcyBOT1QgYSBrZXkuXG4gIF9nZXRNaW5LZXlGcm9tRG9jKGRvYykge1xuICAgIGxldCBtaW5LZXkgPSBudWxsO1xuXG4gICAgdGhpcy5fZ2VuZXJhdGVLZXlzRnJvbURvYyhkb2MsIGtleSA9PiB7XG4gICAgICBpZiAoIXRoaXMuX2tleUNvbXBhdGlibGVXaXRoU2VsZWN0b3Ioa2V5KSkge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmIChtaW5LZXkgPT09IG51bGwpIHtcbiAgICAgICAgbWluS2V5ID0ga2V5O1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmICh0aGlzLl9jb21wYXJlS2V5cyhrZXksIG1pbktleSkgPCAwKSB7XG4gICAgICAgIG1pbktleSA9IGtleTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIFRoaXMgY291bGQgaGFwcGVuIGlmIG91ciBrZXkgZmlsdGVyIHNvbWVob3cgZmlsdGVycyBvdXQgYWxsIHRoZSBrZXlzIGV2ZW5cbiAgICAvLyB0aG91Z2ggc29tZWhvdyB0aGUgc2VsZWN0b3IgbWF0Y2hlcy5cbiAgICBpZiAobWluS2V5ID09PSBudWxsKSB7XG4gICAgICB0aHJvdyBFcnJvcignc29ydCBzZWxlY3RvciBmb3VuZCBubyBrZXlzIGluIGRvYz8nKTtcbiAgICB9XG5cbiAgICByZXR1cm4gbWluS2V5O1xuICB9XG5cbiAgX2dldFBhdGhzKCkge1xuICAgIHJldHVybiB0aGlzLl9zb3J0U3BlY1BhcnRzLm1hcChwYXJ0ID0+IHBhcnQucGF0aCk7XG4gIH1cblxuICBfa2V5Q29tcGF0aWJsZVdpdGhTZWxlY3RvcihrZXkpIHtcbiAgICByZXR1cm4gIXRoaXMuX2tleUZpbHRlciB8fCB0aGlzLl9rZXlGaWx0ZXIoa2V5KTtcbiAgfVxuXG4gIC8vIEdpdmVuIGFuIGluZGV4ICdpJywgcmV0dXJucyBhIGNvbXBhcmF0b3IgdGhhdCBjb21wYXJlcyB0d28ga2V5IGFycmF5cyBiYXNlZFxuICAvLyBvbiBmaWVsZCAnaScuXG4gIF9rZXlGaWVsZENvbXBhcmF0b3IoaSkge1xuICAgIGNvbnN0IGludmVydCA9ICF0aGlzLl9zb3J0U3BlY1BhcnRzW2ldLmFzY2VuZGluZztcblxuICAgIHJldHVybiAoa2V5MSwga2V5MikgPT4ge1xuICAgICAgY29uc3QgY29tcGFyZSA9IExvY2FsQ29sbGVjdGlvbi5fZi5fY21wKGtleTFbaV0sIGtleTJbaV0pO1xuICAgICAgcmV0dXJuIGludmVydCA/IC1jb21wYXJlIDogY29tcGFyZTtcbiAgICB9O1xuICB9XG5cbiAgLy8gSW4gTW9uZ29EQiwgaWYgeW91IGhhdmUgZG9jdW1lbnRzXG4gIC8vICAgIHtfaWQ6ICd4JywgYTogWzEsIDEwXX0gYW5kXG4gIC8vICAgIHtfaWQ6ICd5JywgYTogWzUsIDE1XX0sXG4gIC8vIHRoZW4gQy5maW5kKHt9LCB7c29ydDoge2E6IDF9fSkgcHV0cyB4IGJlZm9yZSB5ICgxIGNvbWVzIGJlZm9yZSA1KS5cbiAgLy8gQnV0ICBDLmZpbmQoe2E6IHskZ3Q6IDN9fSwge3NvcnQ6IHthOiAxfX0pIHB1dHMgeSBiZWZvcmUgeCAoMSBkb2VzIG5vdFxuICAvLyBtYXRjaCB0aGUgc2VsZWN0b3IsIGFuZCA1IGNvbWVzIGJlZm9yZSAxMCkuXG4gIC8vXG4gIC8vIFRoZSB3YXkgdGhpcyB3b3JrcyBpcyBwcmV0dHkgc3VidGxlISAgRm9yIGV4YW1wbGUsIGlmIHRoZSBkb2N1bWVudHNcbiAgLy8gYXJlIGluc3RlYWQge19pZDogJ3gnLCBhOiBbe3g6IDF9LCB7eDogMTB9XX0pIGFuZFxuICAvLyAgICAgICAgICAgICB7X2lkOiAneScsIGE6IFt7eDogNX0sIHt4OiAxNX1dfSksXG4gIC8vIHRoZW4gQy5maW5kKHsnYS54JzogeyRndDogM319LCB7c29ydDogeydhLngnOiAxfX0pIGFuZFxuICAvLyAgICAgIEMuZmluZCh7YTogeyRlbGVtTWF0Y2g6IHt4OiB7JGd0OiAzfX19fSwge3NvcnQ6IHsnYS54JzogMX19KVxuICAvLyBib3RoIGZvbGxvdyB0aGlzIHJ1bGUgKHkgYmVmb3JlIHgpLiAgKGllLCB5b3UgZG8gaGF2ZSB0byBhcHBseSB0aGlzXG4gIC8vIHRocm91Z2ggJGVsZW1NYXRjaC4pXG4gIC8vXG4gIC8vIFNvIGlmIHlvdSBwYXNzIGEgbWF0Y2hlciB0byB0aGlzIHNvcnRlcidzIGNvbnN0cnVjdG9yLCB3ZSB3aWxsIGF0dGVtcHQgdG9cbiAgLy8gc2tpcCBzb3J0IGtleXMgdGhhdCBkb24ndCBtYXRjaCB0aGUgc2VsZWN0b3IuIFRoZSBsb2dpYyBoZXJlIGlzIHByZXR0eVxuICAvLyBzdWJ0bGUgYW5kIHVuZG9jdW1lbnRlZDsgd2UndmUgZ290dGVuIGFzIGNsb3NlIGFzIHdlIGNhbiBmaWd1cmUgb3V0IGJhc2VkXG4gIC8vIG9uIG91ciB1bmRlcnN0YW5kaW5nIG9mIE1vbmdvJ3MgYmVoYXZpb3IuXG4gIF91c2VXaXRoTWF0Y2hlcihtYXRjaGVyKSB7XG4gICAgaWYgKHRoaXMuX2tleUZpbHRlcikge1xuICAgICAgdGhyb3cgRXJyb3IoJ2NhbGxlZCBfdXNlV2l0aE1hdGNoZXIgdHdpY2U/Jyk7XG4gICAgfVxuXG4gICAgLy8gSWYgd2UgYXJlIG9ubHkgc29ydGluZyBieSBkaXN0YW5jZSwgdGhlbiB3ZSdyZSBub3QgZ29pbmcgdG8gYm90aGVyIHRvXG4gICAgLy8gYnVpbGQgYSBrZXkgZmlsdGVyLlxuICAgIC8vIFhYWCBmaWd1cmUgb3V0IGhvdyBnZW9xdWVyaWVzIGludGVyYWN0IHdpdGggdGhpcyBzdHVmZlxuICAgIGlmICghdGhpcy5fc29ydFNwZWNQYXJ0cy5sZW5ndGgpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBzZWxlY3RvciA9IG1hdGNoZXIuX3NlbGVjdG9yO1xuXG4gICAgLy8gSWYgdGhlIHVzZXIganVzdCBwYXNzZWQgYSBsaXRlcmFsIGZ1bmN0aW9uIHRvIGZpbmQoKSwgdGhlbiB3ZSBjYW4ndCBnZXQgYVxuICAgIC8vIGtleSBmaWx0ZXIgZnJvbSBpdC5cbiAgICBpZiAoc2VsZWN0b3IgaW5zdGFuY2VvZiBGdW5jdGlvbikge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGNvbnN0cmFpbnRzQnlQYXRoID0ge307XG5cbiAgICB0aGlzLl9zb3J0U3BlY1BhcnRzLmZvckVhY2goc3BlYyA9PiB7XG4gICAgICBjb25zdHJhaW50c0J5UGF0aFtzcGVjLnBhdGhdID0gW107XG4gICAgfSk7XG5cbiAgICBPYmplY3Qua2V5cyhzZWxlY3RvcikuZm9yRWFjaChrZXkgPT4ge1xuICAgICAgY29uc3Qgc3ViU2VsZWN0b3IgPSBzZWxlY3RvcltrZXldO1xuXG4gICAgICAvLyBYWFggc3VwcG9ydCAkYW5kIGFuZCAkb3JcbiAgICAgIGNvbnN0IGNvbnN0cmFpbnRzID0gY29uc3RyYWludHNCeVBhdGhba2V5XTtcbiAgICAgIGlmICghY29uc3RyYWludHMpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICAvLyBYWFggaXQgbG9va3MgbGlrZSB0aGUgcmVhbCBNb25nb0RCIGltcGxlbWVudGF0aW9uIGlzbid0IFwiZG9lcyB0aGVcbiAgICAgIC8vIHJlZ2V4cCBtYXRjaFwiIGJ1dCBcImRvZXMgdGhlIHZhbHVlIGZhbGwgaW50byBhIHJhbmdlIG5hbWVkIGJ5IHRoZVxuICAgICAgLy8gbGl0ZXJhbCBwcmVmaXggb2YgdGhlIHJlZ2V4cFwiLCBpZSBcImZvb1wiIGluIC9eZm9vKGJhcnxiYXopKy8gIEJ1dFxuICAgICAgLy8gXCJkb2VzIHRoZSByZWdleHAgbWF0Y2hcIiBpcyBhIGdvb2QgYXBwcm94aW1hdGlvbi5cbiAgICAgIGlmIChzdWJTZWxlY3RvciBpbnN0YW5jZW9mIFJlZ0V4cCkge1xuICAgICAgICAvLyBBcyBmYXIgYXMgd2UgY2FuIHRlbGwsIHVzaW5nIGVpdGhlciBvZiB0aGUgb3B0aW9ucyB0aGF0IGJvdGggd2UgYW5kXG4gICAgICAgIC8vIE1vbmdvREIgc3VwcG9ydCAoJ2knIGFuZCAnbScpIGRpc2FibGVzIHVzZSBvZiB0aGUga2V5IGZpbHRlci4gVGhpc1xuICAgICAgICAvLyBtYWtlcyBzZW5zZTogTW9uZ29EQiBtb3N0bHkgYXBwZWFycyB0byBiZSBjYWxjdWxhdGluZyByYW5nZXMgb2YgYW5cbiAgICAgICAgLy8gaW5kZXggdG8gdXNlLCB3aGljaCBtZWFucyBpdCBvbmx5IGNhcmVzIGFib3V0IHJlZ2V4cHMgdGhhdCBtYXRjaFxuICAgICAgICAvLyBvbmUgcmFuZ2UgKHdpdGggYSBsaXRlcmFsIHByZWZpeCksIGFuZCBib3RoICdpJyBhbmQgJ20nIHByZXZlbnQgdGhlXG4gICAgICAgIC8vIGxpdGVyYWwgcHJlZml4IG9mIHRoZSByZWdleHAgZnJvbSBhY3R1YWxseSBtZWFuaW5nIG9uZSByYW5nZS5cbiAgICAgICAgaWYgKHN1YlNlbGVjdG9yLmlnbm9yZUNhc2UgfHwgc3ViU2VsZWN0b3IubXVsdGlsaW5lKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3RyYWludHMucHVzaChyZWdleHBFbGVtZW50TWF0Y2hlcihzdWJTZWxlY3RvcikpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmIChpc09wZXJhdG9yT2JqZWN0KHN1YlNlbGVjdG9yKSkge1xuICAgICAgICBPYmplY3Qua2V5cyhzdWJTZWxlY3RvcikuZm9yRWFjaChvcGVyYXRvciA9PiB7XG4gICAgICAgICAgY29uc3Qgb3BlcmFuZCA9IHN1YlNlbGVjdG9yW29wZXJhdG9yXTtcblxuICAgICAgICAgIGlmIChbJyRsdCcsICckbHRlJywgJyRndCcsICckZ3RlJ10uaW5jbHVkZXMob3BlcmF0b3IpKSB7XG4gICAgICAgICAgICAvLyBYWFggdGhpcyBkZXBlbmRzIG9uIHVzIGtub3dpbmcgdGhhdCB0aGVzZSBvcGVyYXRvcnMgZG9uJ3QgdXNlIGFueVxuICAgICAgICAgICAgLy8gb2YgdGhlIGFyZ3VtZW50cyB0byBjb21waWxlRWxlbWVudFNlbGVjdG9yIG90aGVyIHRoYW4gb3BlcmFuZC5cbiAgICAgICAgICAgIGNvbnN0cmFpbnRzLnB1c2goXG4gICAgICAgICAgICAgIEVMRU1FTlRfT1BFUkFUT1JTW29wZXJhdG9yXS5jb21waWxlRWxlbWVudFNlbGVjdG9yKG9wZXJhbmQpXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIFNlZSBjb21tZW50cyBpbiB0aGUgUmVnRXhwIGJsb2NrIGFib3ZlLlxuICAgICAgICAgIGlmIChvcGVyYXRvciA9PT0gJyRyZWdleCcgJiYgIXN1YlNlbGVjdG9yLiRvcHRpb25zKSB7XG4gICAgICAgICAgICBjb25zdHJhaW50cy5wdXNoKFxuICAgICAgICAgICAgICBFTEVNRU5UX09QRVJBVE9SUy4kcmVnZXguY29tcGlsZUVsZW1lbnRTZWxlY3RvcihcbiAgICAgICAgICAgICAgICBvcGVyYW5kLFxuICAgICAgICAgICAgICAgIHN1YlNlbGVjdG9yXG4gICAgICAgICAgICAgIClcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gWFhYIHN1cHBvcnQgeyRleGlzdHM6IHRydWV9LCAkbW9kLCAkdHlwZSwgJGluLCAkZWxlbU1hdGNoXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgLy8gT0ssIGl0J3MgYW4gZXF1YWxpdHkgdGhpbmcuXG4gICAgICBjb25zdHJhaW50cy5wdXNoKGVxdWFsaXR5RWxlbWVudE1hdGNoZXIoc3ViU2VsZWN0b3IpKTtcbiAgICB9KTtcblxuICAgIC8vIEl0IGFwcGVhcnMgdGhhdCB0aGUgZmlyc3Qgc29ydCBmaWVsZCBpcyB0cmVhdGVkIGRpZmZlcmVudGx5IGZyb20gdGhlXG4gICAgLy8gb3RoZXJzOyB3ZSBzaG91bGRuJ3QgY3JlYXRlIGEga2V5IGZpbHRlciB1bmxlc3MgdGhlIGZpcnN0IHNvcnQgZmllbGQgaXNcbiAgICAvLyByZXN0cmljdGVkLCB0aG91Z2ggYWZ0ZXIgdGhhdCBwb2ludCB3ZSBjYW4gcmVzdHJpY3QgdGhlIG90aGVyIHNvcnQgZmllbGRzXG4gICAgLy8gb3Igbm90IGFzIHdlIHdpc2guXG4gICAgaWYgKCFjb25zdHJhaW50c0J5UGF0aFt0aGlzLl9zb3J0U3BlY1BhcnRzWzBdLnBhdGhdLmxlbmd0aCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRoaXMuX2tleUZpbHRlciA9IGtleSA9PlxuICAgICAgdGhpcy5fc29ydFNwZWNQYXJ0cy5ldmVyeSgoc3BlY1BhcnQsIGluZGV4KSA9PlxuICAgICAgICBjb25zdHJhaW50c0J5UGF0aFtzcGVjUGFydC5wYXRoXS5ldmVyeShmbiA9PiBmbihrZXlbaW5kZXhdKSlcbiAgICAgIClcbiAgICA7XG4gIH1cbn1cblxuLy8gR2l2ZW4gYW4gYXJyYXkgb2YgY29tcGFyYXRvcnNcbi8vIChmdW5jdGlvbnMgKGEsYiktPihuZWdhdGl2ZSBvciBwb3NpdGl2ZSBvciB6ZXJvKSksIHJldHVybnMgYSBzaW5nbGVcbi8vIGNvbXBhcmF0b3Igd2hpY2ggdXNlcyBlYWNoIGNvbXBhcmF0b3IgaW4gb3JkZXIgYW5kIHJldHVybnMgdGhlIGZpcnN0XG4vLyBub24temVybyB2YWx1ZS5cbmZ1bmN0aW9uIGNvbXBvc2VDb21wYXJhdG9ycyhjb21wYXJhdG9yQXJyYXkpIHtcbiAgcmV0dXJuIChhLCBiKSA9PiB7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb21wYXJhdG9yQXJyYXkubGVuZ3RoOyArK2kpIHtcbiAgICAgIGNvbnN0IGNvbXBhcmUgPSBjb21wYXJhdG9yQXJyYXlbaV0oYSwgYik7XG4gICAgICBpZiAoY29tcGFyZSAhPT0gMCkge1xuICAgICAgICByZXR1cm4gY29tcGFyZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gMDtcbiAgfTtcbn1cbiJdfQ==
