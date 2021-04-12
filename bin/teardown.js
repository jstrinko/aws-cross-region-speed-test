'use strict';

const regions = require('./regions');
const builder = new (require('../lib/builder'))(regions);

builder.cleanup();
