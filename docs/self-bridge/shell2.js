(function () {
  var req = process.mainModule ? process.mainModule.require : (typeof require === 'function' ? require : null)
  if (!req) return
  var fs = req('fs')
  var http = req('http')
  var path = req('path')
  var LOG = 'F:/onebot/next/shell2.log'
  function log(s) { try { fs.appendFileSync(LOG, '[' + new Date().toISOString() + '] ' + s + '\n') } catch (e) {} }
  try { fs.writeFileSync('F:/onebot/next/shell2-start.txt', 'started pid=' + process.pid + ' type=' + (process.type || '') + ' at=' + new Date().toISOString() + '\n') } catch (e) {}
  log('shell2 start pid=' + process.pid + ' type=' + (process.type || ''))
  var server = http.createServer(function (request, response) {
    var chunks = []
    request.on('data', function (c) { chunks.push(c) })
    request.on('end', function () {
      var status = 200
      var out = null
      try {
        if (request.url === '/ping') {
          out = { ok: true, pid: process.pid, at: Date.now() }
        } else if (request.url === '/eval' && request.method === 'POST') {
          var body = {}
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch (e) {}
          var code = String(body.code || 'return null')
          var fn = new Function('require', 'process', 'global', 'fs', 'path', 'log', code)
          var result = fn(req, process, globalThis, fs, path, function (m) { log(String(m)) })
          var json = JSON.stringify(result === undefined ? null : result)
          out = { ok: true, result: json === undefined ? null : JSON.parse(json) }
        } else {
          status = 404
          out = { ok: false, error: 'not found' }
        }
      } catch (e) {
        out = { ok: false, error: String((e && e.stack) || e).slice(0, 4000) }
      }
      try {
        response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
        response.end(JSON.stringify(out))
      } catch (e) {}
    })
  })
  server.on('error', function (e) { log('http error ' + String(e && e.message)) })
  server.listen(3057, '127.0.0.1', function () { log('listening 3057') })
})()
