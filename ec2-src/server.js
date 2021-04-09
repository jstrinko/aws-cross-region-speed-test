'use strict';

const express = require('express')();
const port = 3000;

express.get('/test', (req, res) => {
	res.send('ok');
});

express.listen(port, () => {
	console.log('listening');
});
