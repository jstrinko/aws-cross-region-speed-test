'use strict';

const http = require('http');
const hosts = require('./hosts.json');
const port = 3000;
let request_id = 0;

const fetch = (region, host) => {
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
					region,
					host,
					port,
					error
				}));
				return resolve();
			});
			res.on('data', (data) => {
				if (!time_to_first_byte) {
					time_to_first_byte = Date.now() - start;
				}
			});
			res.on('end', () => {
				console.log(JSON.stringify({
					status: 'success',
					total_time: Date.now() - start,
					time_to_first_byte,
					region,
					host,
					port,
					request_id
				}));
				return resolve();
			});
		});
		req.on('error', (error) => {
			console.log(JSON.stringify({
				status: 'fail',
				type: 'request-error',
				time_to_fail: Date.now() - start,
				request_id,
				region,
				host,
				port,
				error
			}));
			return resolve();
		});
		req.end();
	});
};

const ping_em = () => {
	return new Promise((resolve, reject) => {
		Object.keys(hosts).reduce((aggregate, region) => {
			return aggregate.then(() => {
				return fetch(region, hosts[region]);
			});
		}, Promise.resolve())
			.then(() => {
				setTimeout(ping_em, 5000);
			});
	});
};

ping_em();
setInterval(() => { }, 5000); // keepalive
