import path from 'node:path'
import {
  Transform
} from 'node:stream'
import postcss from 'postcss'
import postcssLoadConfig from 'postcss-load-config'
import vinylSourceMaps from 'vinyl-sourcemaps-apply'
import fancyLog from 'fancy-log'
import PluginError from 'plugin-error'

const PLUGIN_NAME = '@sequencemedia/gulp-postcss'

function useLoadConfig (loadConfig) {
  return function loadConfigFor (plugins = {}, options) {
    if (Array.isArray(plugins)) {
      return loadConfig(() => Promise.resolve({ plugins, options }))
    }

    if (plugins instanceof Function) {
      return loadConfig((file) => Promise.resolve(plugins(file)))
    }

    return loadConfig((file) => {
      let configPath = file.dirname

      if (plugins.config) {
        if (path.isAbsolute(plugins.config)) {
          configPath = plugins.config
        } else {
          configPath = path.join(file.base, plugins.config)
        }
      }

      const config = {
        file,
        options: plugins
      }

      return (
        postcssLoadConfig(config, configPath)
      )
    })
  }
}

function getTransformFor (loadConfig) {
  return async function transform (file, encoding, done) {
    if (file.isNull()) {
      done(null, file)
      return
    }

    if (file.isStream()) {
      handleError('Streams are not supported')
      return
    }

    // Protect `from` and `map` if using gulp-sourcemaps
    const isProtected = file.sourceMap
      ? { from: true, map: true }
      : {}

    const options = {
      from: file.path,
      to: file.path,
      // Generate a separate source map for gulp-sourcemaps
      map: file.sourceMap ? { annotation: false } : false
    }

    function handleResult (result) {
      file.contents = Buffer.from(result.css)

      // Apply source map to the chain
      if (file.sourceMap) {
        const map = result.map.toJSON()
        map.file = file.relative
        map.sources = map.sources.map((source) => path.join(path.dirname(file.relative), source))

        vinylSourceMaps(file, map)
      }

      const warnings = result.warnings().join('\n')

      if (warnings) {
        fancyLog.info(
          `${PLUGIN_NAME}:`,
          `${warnings} (${file.relative})`
        )
      }

      // Prevent stream's unhandled exception from
      // being suppressed by Promise
      setImmediate(() => {
        done(null, file)
      })
    }

    function handleError (error) {
      const errorOptions = { fileName: file.path, showStack: true }
      if (error.name === 'CssSyntaxError') {
        errorOptions.error = error
        errorOptions.fileName = error.file || file.path
        errorOptions.lineNumber = error.line
        errorOptions.showProperties = false
        errorOptions.showStack = false
        error = error.message + '\n\n' + error.showSourceCode() + '\n'
      }

      // Prevent stream's unhandled exception from
      // being suppressed by Promise
      setImmediate(() => {
        done(new PluginError(PLUGIN_NAME, error, errorOptions))
      })
    }

    return await (
      loadConfig(file)
        .then((config) => {
          const opts = config.options || {}
          // Extend the default options if not protected
          for (const opt in opts) {
            if (Object.prototype.hasOwnProperty.call(opts, opt) && !isProtected[opt]) {
              options[opt] = opts[opt]
            } else {
              fancyLog.info(
                `${PLUGIN_NAME}:`,
                `Cannot override "${opt}" because it is required by @sequencemedia/gulp-sourcemaps (${file.relative})`
              )
            }
          }

          return (
            postcss(config.plugins || [])
              .process(file.contents, options)
          )
        })
        .then(handleResult)
        .catch(handleError)
    )
  }
}

export default useLoadConfig((loadConfig) => {
  const transform = getTransformFor(loadConfig)

  return new Transform({ transform, objectMode: true })
})
