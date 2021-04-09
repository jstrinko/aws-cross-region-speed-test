'use strict';

const regions = require('../config/regions-lite.json').regions;
const builder = new (require('../lib/builder'))(regions);

builder.configure();
