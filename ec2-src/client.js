'use strict';

const http = require('http');
const ping = require('ping');
const hosts = require('./hosts.json');
const port = 3000;
let request_id = 0;

const fetch = (host) => {
	return new Promise((resolve, reject) => {
		const start = Date.now();
		let time_to_first_byte;
		const req = http.get(`http://${host}:${port}/test`, (res) => {
			res.on('error', (error) => {
				return resolve({
					success: false,
					failure_type: 'response-error',
					time_to_fail: Date.now() - start,
					error
				});
			});
			res.on('data', (data) => {
				if (!time_to_first_byte) {
					time_to_first_byte = Date.now() - start;
				}
			});
			res.on('end', () => {
				return resolve({
					success: true,
					total_time: Date.now() - start,
					time_to_first_byte
				});
			});
		});
		req.on('error', (error) => {
			return resolve({
				success: false,
				failure_type: 'request-error',
				time_to_fail: Date.now() - start,
				error
			});
		});
		req.end();
	});
};

const do_ping = (region, host, http_result) => {
	return ping.promise.probe(host)
		.then((response) => {
			return {
				http: http_result,
				ping: {
					time: response.avg,
					success: response.alive
				},
				region,
				host
			};
		});
};

const report = (result) => {
	console.log(JSON.stringify(result));
};

const ping_em = () => {
	return new Promise((resolve, reject) => {
		Object.keys(hosts).reduce((aggregate, region) => {
			return aggregate.then(() => {
				return fetch(hosts[region])
					.then(do_ping.bind(null, region, hosts[region]))
					.then(report);
			});
		}, Promise.resolve())
			.then(() => {
				setTimeout(ping_em, 5000);
			});
	});
};
ping_em();
setInterval(() => { }, 5000); // keepalive
