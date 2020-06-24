var JSONStream = require('JSONStream');
var defined = require('defined');
var through = require('through2');
var umd = require('umd');
var Buffer = require('safe-buffer').Buffer;

var fs = require('fs');
var path = require('path');

var combineSourceMap = require('combine-source-map');

var defaultPreludePath = path.join(__dirname, '_prelude.js');
var defaultPrelude = fs.readFileSync(defaultPreludePath, 'utf8');

function newlinesIn(src) {
  if (!src) return 0;
  var newlines = src.match(/\n/g);

  return newlines ? newlines.length : 0;
}

module.exports = function (opts) {
    if (!opts) opts = {};
    var parser = opts.raw ? through.obj() : JSONStream.parse([ true ]);
    var stream = through.obj(
        function (buf, enc, next) { parser.write(buf); next() },
        function () { parser.end() }
    );
    parser.pipe(through.obj(write, end));
    stream.standaloneModule = opts.standaloneModule;
    stream.hasExports = opts.hasExports;
    
    var first = true;
    var entries = [];
    var aliases = {}
    var basedir = defined(opts.basedir, process.cwd());
    var prelude = opts.prelude || defaultPrelude;
    var preludePath = opts.preludePath ||
        path.relative(basedir, defaultPreludePath).replace(/\\/g, '/');
    
    var lineno = 1 + newlinesIn(prelude);
    var sourcemap;
    
    return stream;
    
    function write (row, enc, next) {
        if (first && opts.standalone) {
            var pre = umd.prelude(opts.standalone).trim();
            stream.push(Buffer.from(pre + 'return ', 'utf8'));
        }
        else if (first && stream.hasExports) {
            var pre = opts.externalRequireName || 'require';
            stream.push(Buffer.from(pre + '=', 'utf8'));
        }
        if (first) stream.push(Buffer.from(prelude + ';', 'utf8'));
        
        if (row.sourceFile && !row.nomap) {
            if (!sourcemap) {
                sourcemap = combineSourceMap.create(null, opts.sourceRoot);
                sourcemap.addFile(
                    { sourceFile: preludePath, source: prelude },
                    { line: 0 }
                );
            }
            sourcemap.addFile(
                { sourceFile: row.sourceFile, source: row.source },
                { line: lineno }
            );
        }
        Object.keys(row.deps || {}).sort().map(function (key) { aliases[JSON.stringify(key)]= JSON.stringify(path.relative(basedir,row.deps[key])) ; return; } );
        debugger;
        var wrappedSource = [
            "\nrequire.register(",
            '"',
            row.name || path.relative(basedir,row.id),
            '",',
/*
            JSON.stringify(row.id),
            ':[',
*/
            'function(exports,require,module){\n',
            combineSourceMap.removeComments(row.source),
            '\n},',
            '{' + Object.keys(row.deps || {}).sort().map(function (key) {
                return JSON.stringify(key) + ':'
                    + JSON.stringify(path.relative(basedir,row.deps[key]))
                ;
            }).join(',') + '}',
            /* ']' */
            ")"
        ].join('');

        stream.push(Buffer.from(wrappedSource, 'utf8'));
        lineno += newlinesIn(wrappedSource);
        
        first = false;
        if (row.entry && row.order !== undefined) {
            entries[row.order] = row.id;
        }
        else if (row.entry) entries.push(row.id);
        next();
    }
    
    function end () {
        if (first) stream.push(Buffer.from(prelude + '({', 'utf8'));
        entries = entries.filter(function (x) { return x !== undefined });

        stream.push(
            Buffer.from(';/*end pack */\n', 'utf8')
        );
        
        stream.push( 'require.alias("site-loader/app/initialize.coffee","initialize");\nwindow.jQuery=require("jquery");') ;
        Object.keys(aliases).sort().map(function (key) {
          stream.push ( "require.alias(" + aliases[key] + "," + key + ");\n");
          return;
          });

        if (opts.standalone && !first) {
            stream.push(Buffer.from(
                '(' + JSON.stringify(stream.standaloneModule) + ')'
                    + umd.postlude(opts.standalone),
                'utf8'
            ));
        }
        
        if (sourcemap) {
            var comment = sourcemap.comment();
            if (opts.sourceMapPrefix) {
                comment = comment.replace(
                    /^\/\/#/, function () { return opts.sourceMapPrefix }
                )
            }
            stream.push(Buffer.from('\n' + comment + '\n', 'utf8'));
        }
        if (!sourcemap && !opts.standalone) {
            stream.push(Buffer.from(';\n', 'utf8'));
        }

        stream.push(null);
    }
};
