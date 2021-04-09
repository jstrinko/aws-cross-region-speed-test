'use strict';

const http = require('http');
const hosts = require('./hosts.json');
const port = 3000;
let request_id = 0;

const fetch = (host) => {
	return new Promise((resolve, reject) => {
		request_id++;
		const start = Date.now();
		let time_to_first_byte;
		const req = http.get(`http://${host}:${port}/test`, (res) => {
			res.on('error', (error) => {
				console.log(JSON.stringify({
					status: 'fail',
					type: 'response-error',
					time_to_fail: Date.now() - start,
					request_id,
					error
				}));
				return resolve();
			});
		});
		req.on('data', (data) => {
			if (!time_to_first_byte) {
				time_to_first_byte = Date.now() - start;
			}
		});
		req.on('end', () => {
			console.log(JSON.stringify({
				status: 'success',
				total_time: Date.now() - start,
				time_to_first_byte,
				request_id
			}));
			return resolve();
		});
		req.on('error', (error) => {
			console.log(JSON.stringify({
				status: 'fail',
				type: 'request-error',
				time_to_fail: Date.now() - start,
				request_id,
				error
			}));
			return resolve();
		});
	});
};

Object.keys(hosts).reduce((aggregate, host) => {
	return aggregate.then(() => {
		fetch(host);
	});
}, Promise.resolve());
