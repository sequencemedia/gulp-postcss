import assert from 'assert'
import Vinyl from 'vinyl'
import fancyLog from 'fancy-log'
import PluginError from 'plugin-error'
import sourceMaps from 'gulp-sourcemaps'
import postcss from '../index.mjs'
import proxyquire from 'proxyquire'
import sinon from 'sinon'
import path from 'path'
import Processor from 'postcss'

const processor = Processor()

it('should pass file when it isNull()', (done) => {
  const stream = postcss([doubler])
  const emptyFile = {
    isNull: () => { return true }
  }

  stream.once('data', (data) => {
    assert.equal(data, emptyFile)
    done()
  })

  stream.write(emptyFile)

  stream.end()
})

it('should transform css with multiple processors', (done) => {
  const stream = postcss(
    [asyncDoubler, objectDoubler()]
  )

  stream.on('data', (file) => {
    const result = file.contents.toString('utf8')
    const target = 'a { color: black; color: black; color: black; color: black }'
    assert.equal(result, target)
    done()
  })

  stream.write(new Vinyl({
    contents: Buffer.from('a { color: black }')
  }))

  stream.end()
})

it('should not transform css with out any processor', (done) => {
  const css = 'a { color: black }'

  const stream = postcss(() => {
    return {}
  })

  stream.on('data', (file) => {
    const result = file.contents.toString('utf8')
    const target = css
    assert.equal(result, target)
    done()
  })

  stream.write(new Vinyl({
    contents: Buffer.from(css)
  }))

  stream.end()
})

it('should correctly wrap postcss errors', (done) => {
  const stream = postcss([doubler])

  stream.on('error', (err) => {
    assert.ok(err instanceof PluginError)
    assert.equal(err.plugin, 'gulp-postcss')
    assert.equal(err.column, 1)
    assert.equal(err.lineNumber, 1)
    assert.equal(err.name, 'CssSyntaxError')
    assert.equal(err.reason, 'Unclosed block')
    assert.equal(err.showStack, false)
    assert.equal(err.source, 'a {')
    assert.equal(err.fileName, path.resolve('./test'))
    done()
  })

  stream.write(new Vinyl({
    contents: Buffer.from('a {'),
    path: path.resolve('./test')
  }))

  stream.end()
})

it('should respond with error on stream files', (done) => {
  const stream = postcss([doubler])

  stream.on('error', (err) => {
    assert.ok(err instanceof PluginError)
    assert.equal(err.plugin, 'gulp-postcss')
    assert.equal(err.showStack, true)
    assert.equal(err.message, 'Streams are not supported!')
    assert.equal(err.fileName, path.resolve('./test'))
    done()
  })

  const streamFile = {
    isStream () { return true },
    isNull () { return false },
    path: path.resolve('./test')
  }

  stream.write(streamFile)

  stream.end()
})

it('should generate source maps', (done) => {
  const init = sourceMaps.init()
  const write = sourceMaps.write()
  const css = postcss(
    [doubler, asyncDoubler]
  )

  init
    .pipe(css)
    .pipe(write)

  write.on('data', (file) => {
    assert.equal(file.sourceMap.mappings, 'AAAA,IAAI,YAAW,EAAX,YAAW,EAAX,YAAW,EAAX,aAAa')
    assert(/sourceMappingURL=data:application\/json;(?:charset=\w+;)?base64/.test(file.contents.toString()))
    done()
  })

  init.write(new Vinyl({
    base: './test',
    path: './test/fixture.css',
    contents: Buffer.from('a { color: black }')
  }))

  init.end()
})

it('should correctly generate relative source map', (done) => {
  const init = sourceMaps.init()
  const css = postcss(
    [doubler, doubler]
  )

  init.pipe(css)

  css.on('data', (file) => {
    assert.equal(file.sourceMap.file, 'fixture.css')
    assert.deepEqual(file.sourceMap.sources, ['fixture.css'])
    done()
  })

  init.write(new Vinyl({
    base: './test/src',
    path: './test/src/fixture.css',
    contents: Buffer.from('a { color: black }')
  }))

  init.end()
})

describe('PostCSS Guidelines', () => {
  const sandbox = sinon.createSandbox()

  class CssSyntaxError {
    constructor (message, source) {
      this.name = 'CssSyntaxError'
      this.message = message
      this.source = source
    }

    showSourceCode () {
      return this.source
    }

    toString () {
      let code = this.showSourceCode()

      if (code) {
        code = '\n\n' + code + '\n'
      }

      return this.name + ': ' + this.message + code
    }
  }

  const postcssStub = {
    use: () => {},
    process: () => {}
  }

  let postcssLoadConfigStub
  const postcss = proxyquire('./index', {
    postcss: (plugins) => {
      postcssStub.use(plugins)
      return postcssStub
    },
    'postcss-load-config': (ctx, configPath) => {
      return postcssLoadConfigStub(ctx, configPath)
    },
    'vinyl-sourcemaps-apply': () => {
      return {}
    }
  })

  beforeEach(() => {
    postcssLoadConfigStub = sandbox.stub()
    sandbox.stub(postcssStub, 'use')
    sandbox.stub(postcssStub, 'process')
  })

  afterEach(() => {
    sandbox.restore()
  })

  it('should set `from` and `to` processing options to `file.path`', (done) => {
    const stream = postcss([doubler])
    const cssPath = './test/src/fixture.css'
    postcssStub.process.returns(Promise.resolve({
      css: '',
      warnings: () => {
        return []
      }
    }))

    stream.on('data', () => {
      assert.equal(postcssStub.process.getCall(0).args[1].to, cssPath)
      assert.equal(postcssStub.process.getCall(0).args[1].from, cssPath)
      done()
    })

    stream.write(new Vinyl({
      contents: Buffer.from('a {}'),
      path: cssPath
    }))

    stream.end()
  })

  it('should allow override of `to` processing option', (done) => {
    const stream = postcss([doubler], { to: 'overriden' })
    postcssStub.process.returns(Promise.resolve({
      css: '',
      warnings: () => {
        return []
      }
    }))

    stream.on('data', () => {
      assert.equal(postcssStub.process.getCall(0).args[1].to, 'overriden')
      done()
    })

    stream.write(new Vinyl({
      contents: Buffer.from('a {}')
    }))

    stream.end()
  })

  it('should take plugins and options from callback', (done) => {
    const cssPath = './test/fixture.css'
    const file = new Vinyl({
      contents: Buffer.from('a {}'),
      path: cssPath
    })
    const plugins = [doubler]
    const callback = sandbox.stub().returns({
      plugins,
      options: { to: 'overriden' }
    })
    const stream = postcss(callback)

    postcssStub.process.returns(Promise.resolve({
      css: '',
      warnings: () => {
        return []
      }
    }))

    stream.on('data', () => {
      assert.equal(callback.getCall(0).args[0], file)
      assert.equal(postcssStub.use.getCall(0).args[0], plugins)
      assert.equal(postcssStub.process.getCall(0).args[1].to, 'overriden')
      done()
    })

    stream.end(file)
  })

  it('should take plugins and options from postcss-load-config', (done) => {
    const cssPath = './test/fixture.css'
    const file = new Vinyl({
      contents: Buffer.from('a {}'),
      path: cssPath
    })
    const stream = postcss({ to: 'initial' })
    const plugins = [doubler]

    postcssLoadConfigStub.returns(Promise.resolve({
      plugins,
      options: { to: 'overriden' }
    }))

    postcssStub.process.returns(Promise.resolve({
      css: '',
      warnings: () => {
        return []
      }
    }))

    stream.on('data', () => {
      assert.deepEqual(postcssLoadConfigStub.getCall(0).args[0], {
        file,
        options: { to: 'initial' }
      })
      assert.equal(postcssStub.use.getCall(0).args[0], plugins)
      assert.equal(postcssStub.process.getCall(0).args[1].to, 'overriden')
      done()
    })

    stream.end(file)
  })

  it('should point the config location to file directory', (done) => {
    const cssPath = './test/fixture.css'
    const stream = postcss()
    postcssLoadConfigStub.returns(Promise.resolve({ plugins: [] }))
    postcssStub.process.returns(Promise.resolve({
      css: '',
      warnings: () => {
        return []
      }
    }))
    stream.on('data', () => {
      assert.deepEqual(postcssLoadConfigStub.getCall(0).args[1], './test')
      done()
    })
    stream.end(new Vinyl({
      contents: Buffer.from('a {}'),
      path: cssPath
    }))
  })

  it('should set the config location from option', (done) => {
    const cssPath = './test/fixture.css'
    const stream = postcss({ config: '/absolute/path' })
    postcssLoadConfigStub.returns(Promise.resolve({ plugins: [] }))
    postcssStub.process.returns(Promise.resolve({
      css: '',
      warnings: () => {
        return []
      }
    }))
    stream.on('data', () => {
      assert.deepEqual(postcssLoadConfigStub.getCall(0).args[1], '/absolute/path')
      done()
    })
    stream.end(new Vinyl({
      contents: Buffer.from('a {}'),
      path: cssPath
    }))
  })

  it('should set the config location from option relative to the base dir', (done) => {
    const cssPath = './test/src/fixture.css'
    const stream = postcss({ config: './relative/path' })
    postcssLoadConfigStub.returns(Promise.resolve({ plugins: [] }))
    postcssStub.process.returns(Promise.resolve({
      css: '',
      warnings: () => {
        return []
      }
    }))
    stream.on('data', () => {
      assert.deepEqual(postcssLoadConfigStub.getCall(0).args[1], path.join('./test', 'relative/path'))
      done()
    })
    stream.end(new Vinyl({
      contents: Buffer.from('a {}'),
      path: cssPath,
      base: './test'
    }))
  })

  it('should not override `from` and `map` if using gulp-sourcemaps', (done) => {
    const stream = postcss([doubler], { from: 'overriden', map: 'overriden' })
    const cssPath = './test/fixture.css'
    postcssStub.process.returns(Promise.resolve({
      css: '',
      warnings: () => {
        return []
      },
      map: {
        toJSON: () => {
          return {
            sources: [],
            file: ''
          }
        }
      }
    }))

    sandbox.stub(fancyLog, 'info')

    stream.on('data', () => {
      assert.deepEqual(postcssStub.process.getCall(0).args[1].from, cssPath)
      assert.deepEqual(postcssStub.process.getCall(0).args[1].map, { annotation: false })
      const firstMessage = fancyLog.info.getCall(0).args[1]
      const secondMessage = fancyLog.info.getCall(1).args[1]
      assert(firstMessage, '/fixture.css\nCannot override from option, because it is required by gulp-sourcemaps')
      assert(secondMessage, '/fixture.css\nCannot override map option, because it is required by gulp-sourcemaps')
      done()
    })

    const file = new Vinyl({
      contents: Buffer.from('a {}'),
      path: cssPath
    })
    file.sourceMap = {}
    stream.end(file)
  })

  it('should not output js stack trace for `CssSyntaxError`', (done) => {
    const stream = postcss([doubler])
    const cssSyntaxError = new CssSyntaxError('messageText', 'sourceCode')
    postcssStub.process.returns(Promise.reject(cssSyntaxError))

    stream.on('error', (error) => {
      assert.equal(error.showStack, false)
      assert.equal(error.message, 'messageText\n\nsourceCode\n')
      assert.equal(error.source, 'sourceCode')
      done()
    })

    stream.write(new Vinyl({
      contents: Buffer.from('a {}')
    }))

    stream.end()
  })

  it('should display `result.warnings()` content', (done) => {
    const stream = postcss([doubler])
    const cssPath = './test/src/fixture.css'
    function Warning (message) {
      this.toString = () => {
        return message
      }
    }

    sandbox.stub(fancyLog, 'info')
    postcssStub.process.returns(Promise.resolve({
      css: '',
      warnings: () => {
        return [new Warning('msg1'), new Warning('msg2')]
      }
    }))

    stream.on('data', () => {
      assert(fancyLog.info.calledWith('gulp-postcss:', 'src' + path.sep + 'fixture.css\nmsg1\nmsg2'))
      done()
    })

    stream.write(new Vinyl({
      contents: Buffer.from('a {}'),
      path: cssPath
    }))

    stream.end()
  })

  it('should pass options down to PostCSS', (done) => {
    const customSyntax = () => {}
    const options = {
      syntax: customSyntax
    }

    const stream = postcss([doubler], options)
    const cssPath = './test/src/fixture.css'
    postcssStub.process.returns(Promise.resolve({
      css: '',
      warnings: () => {
        return []
      }
    }))

    stream.on('data', () => {
      const resultOptions = postcssStub.process.getCall(0).args[1]
      // remove automatically set options
      delete resultOptions.from
      delete resultOptions.to
      delete resultOptions.map
      assert.deepEqual(resultOptions, options)
      done()
    })

    stream.write(new Vinyl({
      contents: Buffer.from('a {}'),
      path: cssPath
    }))

    stream.end()
  })
})

function doubler (css) {
  css.walkDecls((decl) => {
    decl.parent.prepend(decl.clone())
  })
}

function asyncDoubler (css) {
  return new Promise((resolve) => {
    setTimeout(() => {
      doubler(css)
      resolve()
    })
  })
}

function objectDoubler () {
  processor.use(doubler)
  return processor
}
