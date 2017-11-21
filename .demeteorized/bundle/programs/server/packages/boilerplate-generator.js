(function () {

/* Imports */
var Meteor = Package.meteor.Meteor;
var global = Package.meteor.global;
var meteorEnv = Package.meteor.meteorEnv;
var ECMAScript = Package.ecmascript.ECMAScript;
var _ = Package.underscore._;
var meteorInstall = Package.modules.meteorInstall;
var meteorBabelHelpers = Package['babel-runtime'].meteorBabelHelpers;
var Promise = Package.promise.Promise;

/* Package-scope variables */
var Boilerplate;

var require = meteorInstall({"node_modules":{"meteor":{"boilerplate-generator":{"generator.js":function(require,exports,module){

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                   //
// packages/boilerplate-generator/generator.js                                                                       //
//                                                                                                                   //
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                     //
var _extends2 = require("babel-runtime/helpers/extends");

var _extends3 = _interopRequireDefault(_extends2);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

module.export({
  Boilerplate: () => Boilerplate
});
let readFile;
module.watch(require("fs"), {
  readFile(v) {
    readFile = v;
  }

}, 0);
let WebBrowserTemplate;
module.watch(require("./template-web.browser"), {
  default(v) {
    WebBrowserTemplate = v;
  }

}, 1);
let WebCordovaTemplate;
module.watch(require("./template-web.cordova"), {
  default(v) {
    WebCordovaTemplate = v;
  }

}, 2);

// Copied from webapp_server
const readUtf8FileSync = filename => Meteor.wrapAsync(readFile)(filename, 'utf8');

class Boilerplate {
  constructor(arch, manifest, options = {}) {
    this.template = _getTemplate(arch);
    this.baseData = null;

    this._generateBoilerplateFromManifest(manifest, options);
  } // The 'extraData' argument can be used to extend 'self.baseData'. Its
  // purpose is to allow you to specify data that you might not know at
  // the time that you construct the Boilerplate object. (e.g. it is used
  // by 'webapp' to specify data that is only known at request-time).


  toHTML(extraData) {
    if (!this.baseData || !this.template) {
      throw new Error('Boilerplate did not instantiate correctly.');
    }

    return "<!DOCTYPE html>\n" + this.template((0, _extends3.default)({}, this.baseData, extraData));
  } // XXX Exported to allow client-side only changes to rebuild the boilerplate
  // without requiring a full server restart.
  // Produces an HTML string with given manifest and boilerplateSource.
  // Optionally takes urlMapper in case urls from manifest need to be prefixed
  // or rewritten.
  // Optionally takes pathMapper for resolving relative file system paths.
  // Optionally allows to override fields of the data context.


  _generateBoilerplateFromManifest(manifest, {
    urlMapper = _.identity,
    pathMapper = _.identity,
    baseDataExtension,
    inline
  } = {}) {
    const boilerplateBaseData = (0, _extends3.default)({
      css: [],
      js: [],
      head: '',
      body: '',
      meteorManifest: JSON.stringify(manifest)
    }, baseDataExtension);

    _.each(manifest, item => {
      const urlPath = urlMapper(item.url);
      const itemObj = {
        url: urlPath
      };

      if (inline) {
        itemObj.scriptContent = readUtf8FileSync(pathMapper(item.path));
        itemObj.inline = true;
      }

      if (item.type === 'css' && item.where === 'client') {
        boilerplateBaseData.css.push(itemObj);
      }

      if (item.type === 'js' && item.where === 'client' && // Dynamic JS modules should not be loaded eagerly in the
      // initial HTML of the app.
      !item.path.startsWith('dynamic/')) {
        boilerplateBaseData.js.push(itemObj);
      }

      if (item.type === 'head') {
        boilerplateBaseData.head = readUtf8FileSync(pathMapper(item.path));
      }

      if (item.type === 'body') {
        boilerplateBaseData.body = readUtf8FileSync(pathMapper(item.path));
      }
    });

    this.baseData = boilerplateBaseData;
  }

}

; // Returns a template function that, when called, produces the boilerplate
// html as a string.

const _getTemplate = arch => {
  if (arch === 'web.browser') {
    return WebBrowserTemplate;
  } else if (arch === 'web.cordova') {
    return WebCordovaTemplate;
  } else {
    throw new Error('Unsupported arch: ' + arch);
  }
};
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"template-web.browser.js":function(require,exports,module){

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                   //
// packages/boilerplate-generator/template-web.browser.js                                                            //
//                                                                                                                   //
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                     //
module.exportDefault(function ({
  meteorRuntimeConfig,
  rootUrlPathPrefix,
  inlineScriptsAllowed,
  css,
  js,
  additionalStaticJs,
  htmlAttributes,
  bundledJsCssUrlRewriteHook,
  head,
  body,
  dynamicHead,
  dynamicBody
}) {
  return [].concat(['<html' + _.map(htmlAttributes, (value, key) => _.template(' <%= attrName %>="<%- attrValue %>"')({
    attrName: key,
    attrValue: value
  })).join('') + '>', '<head>'], _.map(css, ({
    url
  }) => _.template('  <link rel="stylesheet" type="text/css" class="__meteor-css__" href="<%- href %>">')({
    href: bundledJsCssUrlRewriteHook(url)
  })), [head, dynamicHead, '</head>', '<body>', body, dynamicBody, '', inlineScriptsAllowed ? _.template('  <script type="text/javascript">__meteor_runtime_config__ = JSON.parse(decodeURIComponent(<%= conf %>))</script>')({
    conf: meteorRuntimeConfig
  }) : _.template('  <script type="text/javascript" src="<%- src %>/meteor_runtime_config.js"></script>')({
    src: rootUrlPathPrefix
  }), ''], _.map(js, ({
    url
  }) => _.template('  <script type="text/javascript" src="<%- src %>"></script>')({
    src: bundledJsCssUrlRewriteHook(url)
  })), _.map(additionalStaticJs, ({
    contents,
    pathname
  }) => inlineScriptsAllowed ? _.template('  <script><%= contents %></script>')({
    contents: contents
  }) : _.template('  <script type="text/javascript" src="<%- src %>"></script>')({
    src: rootUrlPathPrefix + pathname
  })), ['', '', '</body>', '</html>']).join('\n');
});
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"template-web.cordova.js":function(require,exports,module){

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                   //
// packages/boilerplate-generator/template-web.cordova.js                                                            //
//                                                                                                                   //
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                     //
module.exportDefault(function ({
  meteorRuntimeConfig,
  rootUrlPathPrefix,
  inlineScriptsAllowed,
  css,
  js,
  additionalStaticJs,
  htmlAttributes,
  bundledJsCssUrlRewriteHook,
  head,
  body,
  dynamicHead,
  dynamicBody
}) {
  return [].concat(['<html>', '<head>', '  <meta charset="utf-8">', '  <meta name="format-detection" content="telephone=no">', '  <meta name="viewport" content="user-scalable=no, initial-scale=1, maximum-scale=1, minimum-scale=1, width=device-width, height=device-height">', '  <meta name="msapplication-tap-highlight" content="no">', '  <meta http-equiv="Content-Security-Policy" content="default-src * gap: data: blob: \'unsafe-inline\' \'unsafe-eval\' ws: wss:;">'], // We are explicitly not using bundledJsCssUrlRewriteHook: in cordova we serve assets up directly from disk, so rewriting the URL does not make sense
  _.map(css, ({
    url
  }) => _.template('  <link rel="stylesheet" type="text/css" class="__meteor-css__" href="<%- href %>">')({
    href: url
  })), ['  <script type="text/javascript">', _.template('    __meteor_runtime_config__ = JSON.parse(decodeURIComponent(<%= conf %>));')({
    conf: meteorRuntimeConfig
  }), '    if (/Android/i.test(navigator.userAgent)) {', // When Android app is emulated, it cannot connect to localhost,
  // instead it should connect to 10.0.2.2
  // (unless we\'re using an http proxy; then it works!)
  '      if (!__meteor_runtime_config__.httpProxyPort) {', '        __meteor_runtime_config__.ROOT_URL = (__meteor_runtime_config__.ROOT_URL || \'\').replace(/localhost/i, \'10.0.2.2\');', '        __meteor_runtime_config__.DDP_DEFAULT_CONNECTION_URL = (__meteor_runtime_config__.DDP_DEFAULT_CONNECTION_URL || \'\').replace(/localhost/i, \'10.0.2.2\');', '      }', '    }', '  </script>', '', '  <script type="text/javascript" src="/cordova.js"></script>'], _.map(js, ({
    url
  }) => _.template('  <script type="text/javascript" src="<%- src %>"></script>')({
    src: url
  })), _.map(additionalStaticJs, ({
    contents,
    pathname
  }) => inlineScriptsAllowed ? _.template('  <script><%= contents %></script>')({
    contents: contents
  }) : _.template('  <script type="text/javascript" src="<%- src %>"></script>')({
    src: rootUrlPathPrefix + pathname
  })), ['', head, '</head>', '', '<body>', body, '</body>', '</html>']).join('\n');
});
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

}}}}},{
  "extensions": [
    ".js",
    ".json"
  ]
});
var exports = require("./node_modules/meteor/boilerplate-generator/generator.js");

/* Exports */
if (typeof Package === 'undefined') Package = {};
(function (pkg, symbols) {
  for (var s in symbols)
    (s in pkg) || (pkg[s] = symbols[s]);
})(Package['boilerplate-generator'] = exports, {
  Boilerplate: Boilerplate
});

})();

//# sourceURL=meteor://💻app/packages/boilerplate-generator.js
//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvYm9pbGVycGxhdGUtZ2VuZXJhdG9yL2dlbmVyYXRvci5qcyIsIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvYm9pbGVycGxhdGUtZ2VuZXJhdG9yL3RlbXBsYXRlLXdlYi5icm93c2VyLmpzIiwibWV0ZW9yOi8v8J+Su2FwcC9wYWNrYWdlcy9ib2lsZXJwbGF0ZS1nZW5lcmF0b3IvdGVtcGxhdGUtd2ViLmNvcmRvdmEuanMiXSwibmFtZXMiOlsibW9kdWxlIiwiZXhwb3J0IiwiQm9pbGVycGxhdGUiLCJyZWFkRmlsZSIsIndhdGNoIiwicmVxdWlyZSIsInYiLCJXZWJCcm93c2VyVGVtcGxhdGUiLCJkZWZhdWx0IiwiV2ViQ29yZG92YVRlbXBsYXRlIiwicmVhZFV0ZjhGaWxlU3luYyIsImZpbGVuYW1lIiwiTWV0ZW9yIiwid3JhcEFzeW5jIiwiY29uc3RydWN0b3IiLCJhcmNoIiwibWFuaWZlc3QiLCJvcHRpb25zIiwidGVtcGxhdGUiLCJfZ2V0VGVtcGxhdGUiLCJiYXNlRGF0YSIsIl9nZW5lcmF0ZUJvaWxlcnBsYXRlRnJvbU1hbmlmZXN0IiwidG9IVE1MIiwiZXh0cmFEYXRhIiwiRXJyb3IiLCJ1cmxNYXBwZXIiLCJfIiwiaWRlbnRpdHkiLCJwYXRoTWFwcGVyIiwiYmFzZURhdGFFeHRlbnNpb24iLCJpbmxpbmUiLCJib2lsZXJwbGF0ZUJhc2VEYXRhIiwiY3NzIiwianMiLCJoZWFkIiwiYm9keSIsIm1ldGVvck1hbmlmZXN0IiwiSlNPTiIsInN0cmluZ2lmeSIsImVhY2giLCJpdGVtIiwidXJsUGF0aCIsInVybCIsIml0ZW1PYmoiLCJzY3JpcHRDb250ZW50IiwicGF0aCIsInR5cGUiLCJ3aGVyZSIsInB1c2giLCJzdGFydHNXaXRoIiwiZXhwb3J0RGVmYXVsdCIsIm1ldGVvclJ1bnRpbWVDb25maWciLCJyb290VXJsUGF0aFByZWZpeCIsImlubGluZVNjcmlwdHNBbGxvd2VkIiwiYWRkaXRpb25hbFN0YXRpY0pzIiwiaHRtbEF0dHJpYnV0ZXMiLCJidW5kbGVkSnNDc3NVcmxSZXdyaXRlSG9vayIsImR5bmFtaWNIZWFkIiwiZHluYW1pY0JvZHkiLCJjb25jYXQiLCJtYXAiLCJ2YWx1ZSIsImtleSIsImF0dHJOYW1lIiwiYXR0clZhbHVlIiwiam9pbiIsImhyZWYiLCJjb25mIiwic3JjIiwiY29udGVudHMiLCJwYXRobmFtZSJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQUEsT0FBT0MsTUFBUCxDQUFjO0FBQUNDLGVBQVksTUFBSUE7QUFBakIsQ0FBZDtBQUE2QyxJQUFJQyxRQUFKO0FBQWFILE9BQU9JLEtBQVAsQ0FBYUMsUUFBUSxJQUFSLENBQWIsRUFBMkI7QUFBQ0YsV0FBU0csQ0FBVCxFQUFXO0FBQUNILGVBQVNHLENBQVQ7QUFBVzs7QUFBeEIsQ0FBM0IsRUFBcUQsQ0FBckQ7QUFBd0QsSUFBSUMsa0JBQUo7QUFBdUJQLE9BQU9JLEtBQVAsQ0FBYUMsUUFBUSx3QkFBUixDQUFiLEVBQStDO0FBQUNHLFVBQVFGLENBQVIsRUFBVTtBQUFDQyx5QkFBbUJELENBQW5CO0FBQXFCOztBQUFqQyxDQUEvQyxFQUFrRixDQUFsRjtBQUFxRixJQUFJRyxrQkFBSjtBQUF1QlQsT0FBT0ksS0FBUCxDQUFhQyxRQUFRLHdCQUFSLENBQWIsRUFBK0M7QUFBQ0csVUFBUUYsQ0FBUixFQUFVO0FBQUNHLHlCQUFtQkgsQ0FBbkI7QUFBcUI7O0FBQWpDLENBQS9DLEVBQWtGLENBQWxGOztBQUtyUDtBQUNBLE1BQU1JLG1CQUFtQkMsWUFBWUMsT0FBT0MsU0FBUCxDQUFpQlYsUUFBakIsRUFBMkJRLFFBQTNCLEVBQXFDLE1BQXJDLENBQXJDOztBQUVPLE1BQU1ULFdBQU4sQ0FBa0I7QUFDdkJZLGNBQVlDLElBQVosRUFBa0JDLFFBQWxCLEVBQTRCQyxVQUFVLEVBQXRDLEVBQTBDO0FBQ3hDLFNBQUtDLFFBQUwsR0FBZ0JDLGFBQWFKLElBQWIsQ0FBaEI7QUFDQSxTQUFLSyxRQUFM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QU0zQixFQUFOLEVBQVUsQ0FBQztBQUFDUztBQUFELEdBQUQsS0FDUmhCLEVBQUVSLFFBQUYsQ0FBVyw2REFBWCxFQUEwRTtBQUN4RWtELFNBQUsxQjtBQURtRSxHQUExRSxDQURGLENBbENLLEVBd0NMaEIsRUFBRWtDLEdBQUYsQ0FBTU4sa0JBQU4sRUFBMEIsQ0FBQztBQUFDZSxZQUFEO0FBQVdDO0FBQVgsR0FBRCxLQUN2QmpCLHVCQUNHM0IsRUFBRVIsUUFBRixDQUFXLG9DQUFYLEVBQWlEO0FBQ2pEbUQsY0FBVUE7QUFEdUMsR0FBakQsQ0FESCxHQUlHM0MsRUFBRVIsUUFBRixDQUFXLDZEQUFYLEVBQTBFO0FBQzFFa0QsU0FBS2hCLG9CQUFvQmtCO0FBRGlELEdBQTFFLENBTE4sQ0F4Q0ssRUFrREwsQ0FDRSxFQURGLEVBRUVwQyxJQUZGLEVBR0UsU0FIRixFQUlFLEVBSkYsRUFLRSxRQUxGLEVBTUVDLElBTkYsRUFPRSxTQVBGLEVBUUUsU0FSRixDQWxESyxFQTRETDhCLElBNURLLENBNERBLElBNURBLENBQVA7QUE2REQsQ0E3RUQsRSIsImZpbGUiOiIvcGFja2FnZXMvYm9pbGVycGxhdGUtZ2VuZXJhdG9yLmpzIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgcmVhZEZpbGUgfSBmcm9tICdmcyc7XG5cbmltcG9ydCBXZWJCcm93c2VyVGVtcGxhdGUgZnJvbSAnLi90ZW1wbGF0ZS13ZWIuYnJvd3Nlcic7XG5pbXBvcnQgV2ViQ29yZG92YVRlbXBsYXRlIGZyb20gJy4vdGVtcGxhdGUtd2ViLmNvcmRvdmEnO1xuXG4vLyBDb3BpZWQgZnJvbSB3ZWJhcHBfc2VydmVyXG5jb25zdCByZWFkVXRmOEZpbGVTeW5jID0gZmlsZW5hbWUgPT4gTWV0ZW9yLndyYXBBc3luYyhyZWFkRmlsZSkoZmlsZW5hbWUsICd1dGY4Jyk7XG5cbmV4cG9ydCBjbGFzcyBCb2lsZXJwbGF0ZSB7XG4gIGNvbnN0cnVjdG9yKGFyY2gsIG1hbmlmZXN0LCBvcHRpb25zID0ge30pIHtcbiAgICB0aGlzLnRlbXBsYXRlID0gX2dldFRlbXBsYXRlKGFyY2gpO1xuICAgIHRoaXMuYmFzZURhdGEgPSBudWxsO1xuXG4gICAgdGhpcy5fZ2VuZXJhdGVCb2lsZXJwbGF0ZUZyb21NYW5pZmVzdChcbiAgICAgIG1hbmlmZXN0LFxuICAgICAgb3B0aW9uc1xuICAgICk7XG4gIH1cblxuICAvLyBUaGUgJ2V4dHJhRGF0YScgYXJndW1lbnQgY2FuIGJlIHVzZWQgdG8gZXh0ZW5kICdzZWxmLmJhc2VEYXRhJy4gSXRzXG4gIC8vIHB1cnBvc2UgaXMgdG8gYWxsb3cgeW91IHRvIHNwZWNpZnkgZGF0YSB0aGF0IHlvdSBtaWdodCBub3Qga25vdyBhdFxuICAvLyB0aGUgdGltZSB0aGF0IHlvdSBjb25zdHJ1Y3QgdGhlIEJvaWxlcnBsYXRlIG9iamVjdC4gKGUuZy4gaXQgaXMgdXNlZFxuICAvLyBieSAnd2ViYXBwJyB0byBzcGVjaWZ5IGRhdGEgdGhhdCBpcyBvbmx5IGtub3duIGF0IHJlcXVlc3QtdGltZSkuXG4gIHRvSFRNTChleHRyYURhdGEpIHtcbiAgICBpZiAoIXRoaXMuYmFzZURhdGEgfHwgIXRoaXMudGVtcGxhdGUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQm9pbGVycGxhdGUgZGlkIG5vdCBpbnN0YW50aWF0ZSBjb3JyZWN0bHkuJyk7XG4gICAgfVxuXG4gICAgcmV0dXJuICBcIjwhRE9DVFlQRSBodG1sPlxcblwiICtcbiAgICAgIHRoaXMudGVtcGxhdGUoeyAuLi50aGlzLmJhc2VEYXRhLCAuLi5leHRyYURhdGEgfSk7XG4gIH1cblxuICAvLyBYWFggRXhwb3J0ZWQgdG8gYWxsb3cgY2xpZW50LXNpZGUgb25seSBjaGFuZ2VzIHRvIHJlYnVpbGQgdGhlIGJvaWxlcnBsYXRlXG4gIC8vIHdpdGhvdXQgcmVxdWlyaW5nIGEgZnVsbCBzZXJ2ZXIgcmVzdGFydC5cbiAgLy8gUHJvZHVjZXMgYW4gSFRNTCBzdHJpbmcgd2l0aCBnaXZlbiBtYW5pZmVzdCBhbmQgYm9pbGVycGxhdGVTb3VyY2UuXG4gIC8vIE9wdGlvbmFsbHkgdGFrZXMgdXJsTWFwcGVyIGluIGNhc2UgdXJscyBmcm9tIG1hbmlmZXN0IG5lZWQgdG8gYmUgcHJlZml4ZWRcbiAgLy8gb3IgcmV3cml0dGVuLlxuICAvLyBPcHRpb25hbGx5IHRha2VzIHBhdGhNYXBwZXIgZm9yIHJlc29sdmluZyByZWxhdGl2ZSBmaWxlIHN5c3RlbSBwYXRocy5cbiAgLy8gT3B0aW9uYWxseSBhbGxvd3MgdG8gb3ZlcnJpZGUgZmllbGRzIG9mIHRoZSBkYXRhIGNvbnRleHQuXG4gIF9nZW5lcmF0ZUJvaWxlcnBsYXRlRnJvbU1hbmlmZXN0KG1hbmlmZXN0LCB7XG4gICAgdXJsTWFwcGVyID0gXy5pZGVudGl0eSxcbiAgICBwYXRoTWFwcGVyID0gXy5pZGVudGl0eSxcbiAgICBiYXNlRGF0YUV4dGVuc2lvbixcbiAgICBpbmxpbmUsXG4gIH0gPSB7fSkge1xuXG4gICAgY29uc3QgYm9pbGVycGxhdGVCYXNlRGF0YSA9IHtcbiAgICAgIGNzczogW10sXG4gICAgICBqczogW10sXG4gICAgICBoZWFkOiAnJyxcbiAgICAgIGJvZHk6ICcnLFxuICAgICAgbWV0ZW9yTWFuaWZlc3Q6IEpTT04uc3RyaW5naWZ5KG1hbmlmZXN0KSxcbiAgICAgIC4uLmJhc2VEYXRhRXh0ZW5zaW9uLFxuICAgIH07XG5cbiAgICBfLmVhY2gobWFuaWZlc3QsIGl0ZW0gPT4ge1xuICAgICAgY29uc3QgdXJsUGF0aCA9IHVybE1hcHBlcihpdGVtLnVybCk7XG4gICAgICBjb25zdCBpdGVtT2JqID0geyB1cmw6IHVybFBhdGggfTtcblxuICAgICAgaWYgKGlubGluZSkge1xuICAgICAgICBpdGVtT2JqLnNjcmlwdENvbnRlbnQgPSByZWFkVXRmOEZpbGVTeW5jKFxuICAgICAgICAgIHBhdGhNYXBwZXIoaXRlbS5wYXRoKSk7XG4gICAgICAgIGl0ZW1PYmouaW5saW5lID0gdHJ1ZTtcbiAgICAgIH1cblxuICAgICAgaWYgKGl0ZW0udHlwZSA9PT0gJ2NzcycgJiYgaXRlbS53aGVyZSA9PT0gJ2NsaWVudCcpIHtcbiAgICAgICAgYm9pbGVycGxhdGVCYXNlRGF0YS5jc3MucHVzaChpdGVtT2JqKTtcbiAgICAgIH1cblxuICAgICAgaWYgKGl0ZW0udHlwZSA9PT0gJ2pzJyAmJiBpdGVtLndoZXJlID09PSAnY2xpZW50JyAmJlxuICAgICAgICAvLyBEeW5hbWljIEpTIG1vZHVsZXMgc2hvdWxkIG5vdCBiZSBsb2FkZWQgZWFnZXJseSBpbiB0aGVcbiAgICAgICAgLy8gaW5pdGlhbCBIVE1MIG9mIHRoZSBhcHAuXG4gICAgICAgICFpdGVtLnBhdGguc3RhcnRzV2l0aCgnZHluYW1pYy8nKSkge1xuICAgICAgICBib2lsZXJwbGF0ZUJhc2VEYXRhLmpzLnB1c2goaXRlbU9iaik7XG4gICAgICB9XG5cbiAgICAgIGlmIChpdGVtLnR5cGUgPT09ICdoZWFkJykge1xuICAgICAgICBib2lsZXJwbGF0ZUJhc2VEYXRhLmhlYWQgPVxuICAgICAgICAgIHJlYWRVdGY4RmlsZVN5bmMocGF0aE1hcHBlcihpdGVtLnBhdGgpKTtcbiAgICAgIH1cblxuICAgICAgaWYgKGl0ZW0udHlwZSA9PT0gJ2JvZHknKSB7XG4gICAgICAgIGJvaWxlcnBsYXRlQmFzZURhdGEuYm9keSA9XG4gICAgICAgICAgcmVhZFV0ZjhGaWxlU3luYyhwYXRoTWFwcGVyKGl0ZW0ucGF0aCkpO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgdGhpcy5iYXNlRGF0YSA9IGJvaWxlcnBsYXRlQmFzZURhdGE7XG4gIH1cbn07XG5cbi8vIFJldHVybnMgYSB0ZW1wbGF0ZSBmdW5jdGlvbiB0aGF0LCB3aGVuIGNhbGxlZCwgcHJvZHVjZXMgdGhlIGJvaWxlcnBsYXRlXG4vLyBodG1sIGFzIGEgc3RyaW5nLlxuY29uc3QgX2dldFRlbXBsYXRlID0gYXJjaCA9PiB7XG4gIGlmIChhcmNoID09PSAnd2ViLmJyb3dzZXInKSB7XG4gICAgcmV0dXJuIFdlYkJyb3dzZXJUZW1wbGF0ZTtcbiAgfSBlbHNlIGlmIChhcmNoID09PSAnd2ViLmNvcmRvdmEnKSB7XG4gICAgcmV0dXJuIFdlYkNvcmRvdmFUZW1wbGF0ZTtcbiAgfSBlbHNlIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ1Vuc3VwcG9ydGVkIGFyY2g6ICcgKyBhcmNoKTtcbiAgfVxufTtcbiIsIi8vIFRlbXBsYXRlIGZ1bmN0aW9uIGZvciByZW5kZXJpbmcgdGhlIGJvaWxlcnBsYXRlIGh0bWwgZm9yIGJyb3dzZXJzXG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHtcbiAgbWV0ZW9yUnVudGltZUNvbmZpZyxcbiAgcm9vdFVybFBhdGhQcmVmaXgsXG4gIGlubGluZVNjcmlwdHNBbGxvd2VkLFxuICBjc3MsXG4gIGpzLFxuICBhZGRpdGlvbmFsU3RhdGljSnMsXG4gIGh0bWxBdHRyaWJ1dGVzLFxuICBidW5kbGVkSnNDc3NVcmxSZXdyaXRlSG9vayxcbiAgaGVhZCxcbiAgYm9keSxcbiAgZHluYW1pY0hlYWQsXG4gIGR5bmFtaWNCb2R5LFxufSkge1xuICByZXR1cm4gW10uY29uY2F0KFxuICAgIFtcbiAgICAgICc8aHRtbCcgK18ubWFwKGh0bWxBdHRyaWJ1dGVzLCAodmFsdWUsIGtleSkgPT5cbiAgICAgICAgXy50ZW1wbGF0ZSgnIDwlPSBhdHRyTmFtZSAlPj1cIjwlLSBhdHRyVmFsdWUgJT5cIicpKHtcbiAgICAgICAgICBhdHRyTmFtZToga2V5LFxuICAgICAgICAgIGF0dHJWYWx1ZTogdmFsdWVcbiAgICAgICAgfSlcbiAgICAgICkuam9pbignJykgKyAnPicsXG4gICAgICAnPGhlYWQ+J1xuICAgIF0sXG5cbiAgICBfLm1hcChjc3MsICh7dXJsfSkgPT5cbiAgICAgIF8udGVtcGxhdGUoJyAgPGxpbmsgcmVsPVwic3R5bGVzaGVldFwiIHR5cGU9XCJ0ZXh0L2Nzc1wiIGNsYXNzPVwiX19tZXRlb3ItY3NzX19cIiBocmVmPVwiPCUtIGhyZWYgJT5cIj4nKSh7XG4gICAgICAgIGhyZWY6IGJ1bmRsZWRKc0Nzc1VybFJld3JpdGVIb29rKHVybClcbiAgICAgIH0pXG4gICAgKSxcblxuICAgIFtcbiAgICAgIGhlYWQsXG4gICAgICBkeW5hbWljSGVhZCxcbiAgICAgICc8L2hlYWQ+JyxcbiAgICAgICc8Ym9keT4nLFxuICAgICAgYm9keSxcbiAgICAgIGR5bmFtaWNCb2R5LFxuICAgICAgJycsXG4gICAgICAoaW5saW5lU2NyaXB0c0FsbG93ZWRcbiAgICAgICAgPyBfLnRlbXBsYXRlKCcgIDxzY3JpcHQgdHlwZT1cInRleHQvamF2YXNjcmlwdFwiPl9fbWV0ZW9yX3J1bnRpbWVfY29uZmlnX18gPSBKU09OLnBhcnNlKGRlY29kZVVSSUNvbXBvbmVudCg8JT0gY29uZiAlPikpPC9zY3JpcHQ+Jykoe1xuICAgICAgICAgIGNvbmY6IG1ldGVvclJ1bnRpbWVDb25maWdcbiAgICAgICAgfSlcbiAgICAgICAgOiBfLnRlbXBsYXRlKCcgIDxzY3JpcHQgdHlwZT1cInRleHQvamF2YXNjcmlwdFwiIHNyYz1cIjwlLSBzcmMgJT4vbWV0ZW9yX3J1bnRpbWVfY29uZmlnLmpzXCI+PC9zY3JpcHQ+Jykoe1xuICAgICAgICAgIHNyYzogcm9vdFVybFBhdGhQcmVmaXhcbiAgICAgICAgfSlcbiAgICAgICkgLFxuICAgICAgJydcbiAgICBdLFxuXG4gICAgXy5tYXAoanMsICh7dXJsfSkgPT5cbiAgICAgIF8udGVtcGxhdGUoJyAgPHNjcmlwdCB0eXBlPVwidGV4dC9qYXZhc2NyaXB0XCIgc3JjPVwiPCUtIHNyYyAlPlwiPjwvc2NyaXB0PicpKHtcbiAgICAgICAgc3JjOiBidW5kbGVkSnNDc3NVcmxSZXdyaXRlSG9vayh1cmwpXG4gICAgICB9KVxuICAgICksXG5cbiAgICBfLm1hcChhZGRpdGlvbmFsU3RhdGljSnMsICh7Y29udGVudHMsIHBhdGhuYW1lfSkgPT4gKFxuICAgICAgKGlubGluZVNjcmlwdHNBbGxvd2VkXG4gICAgICAgID8gXy50ZW1wbGF0ZSgnICA8c2NyaXB0PjwlPSBjb250ZW50cyAlPjwvc2NyaXB0PicpKHtcbiAgICAgICAgICBjb250ZW50czogY29udGVudHNcbiAgICAgICAgfSlcbiAgICAgICAgOiBfLnRlbXBsYXRlKCcgIDxzY3JpcHQgdHlwZT1cInRleHQvamF2YXNjcmlwdFwiIHNyYz1cIjwlLSBzcmMgJT5cIj48L3NjcmlwdD4nKSh7XG4gICAgICAgICAgc3JjOiByb290VXJsUGF0aFByZWZpeCArIHBhdGhuYW1lXG4gICAgICAgIH0pKVxuICAgICkpLFxuXG4gICAgW1xuICAgICAgJycsICcnLFxuICAgICAgJzwvYm9keT4nLFxuICAgICAgJzwvaHRtbD4nXG4gICAgXSxcbiAgKS5qb2luKCdcXG4nKTtcbn1cblxuIiwiLy8gVGVtcGxhdGUgZnVuY3Rpb24gZm9yIHJlbmRlcmluZyB0aGUgYm9pbGVycGxhdGUgaHRtbCBmb3IgY29yZG92YVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbih7XG4gIG1ldGVvclJ1bnRpbWVDb25maWcsXG4gIHJvb3RVcmxQYXRoUHJlZml4LFxuICBpbmxpbmVTY3JpcHRzQWxsb3dlZCxcbiAgY3NzLFxuICBqcyxcbiAgYWRkaXRpb25hbFN0YXRpY0pzLFxuICBodG1sQXR0cmlidXRlcyxcbiAgYnVuZGxlZEpzQ3NzVXJsUmV3cml0ZUhvb2ssXG4gIGhlYWQsXG4gIGJvZHksXG4gIGR5bmFtaWNIZWFkLFxuICBkeW5hbWljQm9keSxcbn0pIHtcbiAgcmV0dXJuIFtdLmNvbmNhdChcbiAgICBbXG4gICAgICAnPGh0bWw+JyxcbiAgICAgICc8aGVhZD4nLFxuICAgICAgJyAgPG1ldGEgY2hhcnNldD1cInV0Zi04XCI+JyxcbiAgICAgICcgIDxtZXRhIG5hbWU9XCJmb3JtYXQtZGV0ZWN0aW9uXCIgY29udGVudD1cInRlbGVwaG9uZT1ub1wiPicsXG4gICAgICAnICA8bWV0YSBuYW1lPVwidmlld3BvcnRcIiBjb250ZW50PVwidXNlci1zY2FsYWJsZT1ubywgaW5pdGlhbC1zY2FsZT0xLCBtYXhpbXVtLXNjYWxlPTEsIG1pbmltdW0tc2NhbGU9MSwgd2lkdGg9ZGV2aWNlLXdpZHRoLCBoZWlnaHQ9ZGV2aWNlLWhlaWdodFwiPicsXG4gICAgICAnICA8bWV0YSBuYW1lPVwibXNhcHBsaWNhdGlvbi10YXAtaGlnaGxpZ2h0XCIgY29udGVudD1cIm5vXCI+JyxcbiAgICAgICcgIDxtZXRhIGh0dHAtZXF1aXY9XCJDb250ZW50LVNlY3VyaXR5LVBvbGljeVwiIGNvbnRlbnQ9XCJkZWZhdWx0LXNyYyAqIGdhcDogZGF0YTogYmxvYjogXFwndW5zYWZlLWlubGluZVxcJyBcXCd1bnNhZmUtZXZhbFxcJyB3czogd3NzOjtcIj4nLFxuICAgIF0sXG4gICAgLy8gV2UgYXJlIGV4cGxpY2l0bHkgbm90IHVzaW5nIGJ1bmRsZWRKc0Nzc1VybFJld3JpdGVIb29rOiBpbiBjb3Jkb3ZhIHdlIHNlcnZlIGFzc2V0cyB1cCBkaXJlY3RseSBmcm9tIGRpc2ssIHNvIHJld3JpdGluZyB0aGUgVVJMIGRvZXMgbm90IG1ha2Ugc2Vuc2VcbiAgICBfLm1hcChjc3MsICh7dXJsfSkgPT5cbiAgICAgIF8udGVtcGxhdGUoJyAgPGxpbmsgcmVsPVwic3R5bGVzaGVldFwiIHR5cGU9XCJ0ZXh0L2Nzc1wiIGNsYXNzPVwiX19tZXRlb3ItY3NzX19cIiBocmVmPVwiPCUtIGhyZWYgJT5cIj4nKSh7XG4gICAgICAgIGhyZWY6IHVybFxuICAgICAgfSlcbiAgICApLFxuICAgIFtcbiAgICAgICcgIDxzY3JpcHQgdHlwZT1cInRleHQvamF2YXNjcmlwdFwiPicsXG4gICAgICBfLnRlbXBsYXRlKCcgICAgX19tZXRlb3JfcnVudGltZV9jb25maWdfXyA9IEpTT04ucGFyc2UoZGVjb2RlVVJJQ29tcG9uZW50KDwlPSBjb25mICU+KSk7Jykoe1xuICAgICAgICBjb25mOiBtZXRlb3JSdW50aW1lQ29uZmlnXG4gICAgICB9KSxcbiAgICAgICcgICAgaWYgKC9BbmRyb2lkL2kudGVzdChuYXZpZ2F0b3IudXNlckFnZW50KSkgeycsXG4gICAgICAvLyBXaGVuIEFuZHJvaWQgYXBwIGlzIGVtdWxhdGVkLCBpdCBjYW5ub3QgY29ubmVjdCB0byBsb2NhbGhvc3QsXG4gICAgICAvLyBpbnN0ZWFkIGl0IHNob3VsZCBjb25uZWN0IHRvIDEwLjAuMi4yXG4gICAgICAvLyAodW5sZXNzIHdlXFwncmUgdXNpbmcgYW4gaHR0cCBwcm94eTsgdGhlbiBpdCB3b3JrcyEpXG4gICAgICAnICAgICAgaWYgKCFfX21ldGVvcl9ydW50aW1lX2NvbmZpZ19fLmh0dHBQcm94eVBvcnQpIHsnLFxuICAgICAgJyAgICAgICAgX19tZXRlb3JfcnVudGltZV9jb25maWdfXy5ST09UX1VSTCA9IChfX21ldGVvcl9ydW50aW1lX2NvbmZpZ19fLlJPT1RfVVJMIHx8IFxcJ1xcJykucmVwbGFjZSgvbG9jYWxob3N0L2ksIFxcJzEwLjAuMi4yXFwnKTsnLFxuICAgICAgJyAgICAgICAgX19tZXRlb3JfcnVudGltZV9jb25maWdfXy5ERFBfREVGQVVMVF9DT05ORUNUSU9OX1VSTCA9IChfX21ldGVvcl9ydW50aW1lX2NvbmZpZ19fLkREUF9ERUZBVUxUX0NPTk5FQ1RJT05fVVJMIHx8IFxcJ1xcJykucmVwbGFjZSgvbG9jYWxob3N0L2ksIFxcJzEwLjAuMi4yXFwnKTsnLFxuICAgICAgJyAgICAgIH0nLFxuICAgICAgJyAgICB9JyxcbiAgICAgICcgIDwvc2NyaXB0PicsXG4gICAgICAnJyxcbiAgICAgICcgIDxzY3JpcHQgdHlwZT1cInRleHQvamF2YXNjcmlwdFwiIHNyYz1cIi9jb3Jkb3ZhLmpzXCI+PC9zY3JpcHQ+J1xuICAgIF0sXG4gICAgXy5tYXAoanMsICh7dXJsfSkgPT5cbiAgICAgIF8udGVtcGxhdGUoJyAgPHNjcmlwdCB0eXBlPVwidGV4dC9qYXZhc2NyaXB0XCIgc3JjPVwiPCUtIHNyYyAlPlwiPjwvc2NyaXB0PicpKHtcbiAgICAgICAgc3JjOiB1cmxcbiAgICAgIH0pXG4gICAgKSxcblxuICAgIF8ubWFwKGFkZGl0aW9uYWxTdGF0aWNKcywgKHtjb250ZW50cywgcGF0aG5hbWV9KSA9PiAoXG4gICAgICAoaW5saW5lU2NyaXB0c0FsbG93ZWRcbiAgICAgICAgPyBfLnRlbXBsYXRlKCcgIDxzY3JpcHQ+PCU9IGNvbnRlbnRzICU+PC9zY3JpcHQ+Jykoe1xuICAgICAgICAgIGNvbnRlbnRzOiBjb250ZW50c1xuICAgICAgICB9KVxuICAgICAgICA6IF8udGVtcGxhdGUoJyAgPHNjcmlwdCB0eXBlPVwidGV4dC9qYXZhc2NyaXB0XCIgc3JjPVwiPCUtIHNyYyAlPlwiPjwvc2NyaXB0PicpKHtcbiAgICAgICAgICBzcmM6IHJvb3RVcmxQYXRoUHJlZml4ICsgcGF0aG5hbWVcbiAgICAgICAgfSkpXG4gICAgKSksXG5cbiAgICBbXG4gICAgICAnJyxcbiAgICAgIGhlYWQsXG4gICAgICAnPC9oZWFkPicsXG4gICAgICAnJyxcbiAgICAgICc8Ym9keT4nLFxuICAgICAgYm9keSxcbiAgICAgICc8L2JvZHk+JyxcbiAgICAgICc8L2h0bWw+J1xuICAgIF0sXG4gICkuam9pbignXFxuJyk7XG59XG5cbiJdfQ==
