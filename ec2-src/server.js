'use strict';

const express = require('express')();
const port = 3000;

express.get('/test', (req, res) => {
	res.send('ok');
	console.log(req);
});
console.log(`Attempting to listen on port ${port}`);
express.listen(port, () => {
	console.log('listening');
});
