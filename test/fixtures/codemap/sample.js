// CommonJS fixture
const fs = require('fs');
const { helper } = require('./helper');

function parse(text) {
  return text.split('\n');
}

exports.parse = parse;
exports.VERSION = '1.0';
module.exports.run = function run() {
  return helper(fs);
};
