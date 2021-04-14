'use strict';

const aws = require('aws-sdk');
const child_process = require('child_process');
const fs = require('fs');
const scp = require('node-scp');
const table = require('table');

const Filters = [
	{
		Name: 'tag:test',
		Values: [
			'crossregion'
		]
	}
];

class Builder {
	constructor(regions) {
		this.aws_ec2s = {};
		regions.forEach((region) => {
			this.aws_ec2s[region] = new aws.EC2({
				apiVersion: '2016-11-15',
				region
			});
		});
	}
	build() {
		return this.cleanup()
			.then(this.create_security_groups.bind(this))
			.then(this.check_key_pairs.bind(this))
			.then(this.create_key_pairs.bind(this))
			.then(this.check_instances_status.bind(this))
			.then(this.find_amis.bind(this))
			.then(this.create_new_instances.bind(this))
			.catch(this.fail);
	}
	configure() {
		return this.check_instances_status()
			.then(this.wait_for_instances_running.bind(this))
			.then(this.build_hosts.bind(this))
			.then(this.configure_instances.bind(this))
			.catch(this.fail);
	}
	cleanup() {
		return this.check_key_pairs()
			.then(this.cleanup_key_pairs.bind(this))
			.then(this.check_instances_status.bind(this))
			.then(this.cleanup_instances.bind(this))
			.then(this.wait_for_instances_terminated.bind(this))
			.then(this.cleanup_security_groups.bind(this))
			.catch(this.fail);
	}
	report() {
		return this.check_instances_status()
			.then(this.build_hosts.bind(this))
			.then(this.gather_logs.bind(this))
			.then(this.generate_report.bind(this));
	}
	fail(error) {
		console.error("Failure:", error);
	}
	generate_report() {
		const sorted_regions = Object.keys(this.test_logs).sort();
		const full_report = sorted_regions.reduce((report, region) => {
			const logs = this.test_logs[region];
			const counts = logs.reduce((aggregate, entry) => {
				const region = entry.region;
				if (!region) { return aggregate; }
				if (!entry.http.success) { return aggregate; }
				aggregate[region] = aggregate[region] || {};
				aggregate[region].count = aggregate[region].count || 0;
				aggregate[region].count++;
				aggregate[region].total_http_time = aggregate[region].total_http_time || 0;
				aggregate[region].total_http_time += entry.http.total_time;
				aggregate[region].total_ping_time = aggregate[region].total_ping_time || 0;
				aggregate[region].total_ping_time += parseInt(entry.ping.time, 10) || 0;
				return aggregate;
			}, {});
			const averages = sorted_regions.reduce((aggregate, region) => {
				aggregate[region] = {
					http: counts[region].total_http_time / counts[region].count,
					ping: counts[region].total_ping_time / counts[region].count
				};
				return aggregate;
			}, {});
			report.push([region].concat(sorted_regions.map((region) => {
				return `${Math.round(averages[region].ping)}/${Math.round(averages[region].http)}`;
			})));
			return report;
		}, [[null].concat(sorted_regions)]);
		console.log(table.table(full_report));
	}
	wait_for_instances_running() {
		console.log("Waiting for instances to be running...");
		return Promise.all(Object.keys(this.aws_ec2s).map((region) => {
			return this.wait_for_instance_running_in_region(region);
		}));
	}
	wait_for_instances_terminated() {
		console.log("Waiting for instances to be terminated...");
		return Promise.all(Object.keys(this.aws_ec2s).map((region) => {
			return this.wait_for_instance_terminated_in_region(region);
		}));
	}
	gather_logs() {
		console.warn("Gathering logs...");
		return this.for_all_regions(this.gather_logs_for_region.bind(this));
	}
	configure_instances() {
		console.warn("Configuring instances...");
		return this.for_all_regions(this.configure_instance_in_region.bind(this));
	}
	check_key_pairs() {
		console.log("Checking Key Pairs...");
		this.key_pairs = {};
		return this.for_all_regions(this.check_key_pair.bind(this));
	}
	create_key_pairs() {
		console.log("Creating key pairs...");
		this.created_key_pairs = {};
		return this.for_all_regions(this.create_key_pair.bind(this));
	}
	cleanup_key_pairs() {
		console.log("Cleaning up Key Pairs...");
		return this.for_all_regions(this.cleanup_key_pair_in_region.bind(this));
	}
	check_instances_status() {
		console.log("Checking instances status...");
		this.instance_status = {};
		return this.for_all_regions(this.check_instance_status_in_region.bind(this));
	}
	create_new_instances() {
		console.log("Creating new instances...");
		this.created_instances = {};
		return this.for_all_regions(this.create_new_instance.bind(this));
	}
	find_amis() {
		console.log("Finding matching AMIs...");
		this.amis = {};
		return this.for_all_regions(this.find_ami_for_region.bind(this));
	}
	cleanup_instances() {
		console.log("Cleaning up instances...");
		return this.for_all_regions(this.cleanup_instances_in_region.bind(this));
	}
	cleanup_security_groups() {
		console.log("Cleaning up security groups...");
		return this.for_all_regions(this.cleanup_security_group_in_region.bind(this));
	}
	create_security_groups() {
		console.log("Creating security groups...");
		this.security_groups = {};
		return this.for_all_regions(this.create_security_group_in_region.bind(this));
	}
	cleanup_security_group_in_region(region) {
		return this.aws_ec2s[region].deleteSecurityGroup({
			GroupName: `regional-test-security-group-${region}`
		})
			.promise()
			.then((result) => {
				console.warn("Deleted security group:", region, result);
			})
			.catch((error) => {
				console.warn("Error deleting security group:", region, error);
			});
	}
	create_security_group_in_region(region) {
		return this.aws_ec2s[region].createSecurityGroup({
			GroupName: `regional-test-security-group-${region}`,
			Description: 'Security group for testing AWS cross-region network'
		}).promise()
			.then((result) => {
				const params = {
					GroupId: result.GroupId,
					IpPermissions: [
						{
							IpProtocol: 'tcp',
							FromPort: 22,
							ToPort: 22,
							IpRanges: [
								{
									CidrIp: '0.0.0.0/0'
								}
							]
						},
						{
							IpProtocol: 'tcp',
							FromPort: 3000,
							ToPort: 3000,
							IpRanges: [
								{
									CidrIp: '0.0.0.0/0'
								}
							]
						},
						{
							IpProtocol: 'icmp',
							FromPort: -1,
							ToPort: -1,
							IpRanges: [
								{
									CidrIp: '0.0.0.0/0'
								}
							]
						}
					]
				};
				return this.aws_ec2s[region].authorizeSecurityGroupIngress(params)
					.promise()
					.then((result) => {
						console.warn("Authorized security group", region, result);
					});
			});
	}
	wait_for_instance_running_in_region(region) {
		const instance_ids = this.get_all_instance_ids(region);
		if (!instance_ids.length) {
			console.warn("Skipping wait for region, no instances", region);
			return;
		}
		console.warn('Waiting for', region, instance_ids);
		return this.aws_ec2s[region].waitFor(
			'instanceRunning',
			{ Filters: [{
				Name: 'instance-id',
				Values: instance_ids
			}]}
		).promise()
			.then((data) => {
				console.warn(data.Reservations[0].Instances[0].NetworkInterfaces);
			});
	}
	wait_for_instance_terminated_in_region(region) {
		const instance_ids = this.terminated_instance_ids && this.terminated_instance_ids[region] ?
			this.terminated_instance_ids[region] : [];
		if (!instance_ids.length) {
			console.warn("Skipping wait for region, no instances", region);
			return;
		}
		console.warn('Waiting for termination', region, instance_ids);
		return this.aws_ec2s[region].waitFor(
			'instanceTerminated',
			{ Filters: [{
				Name: 'instance-id',
				Values: instance_ids
			}]}
		).promise()
			.then((data) => {
				console.warn(data.Reservations[0].Instances[0].NetworkInterfaces);
			});
	}
	build_hosts() {
		console.warn("Writing hosts file...");
		this.hosts = Object.keys(this.instance_status).reduce((aggregate, key) => {
			try {
				aggregate[key] = this.instance_status[key].Reservations[0].Instances[0].NetworkInterfaces[0].Association.PublicDnsName;
			}
			catch(error) {
				return aggregate;
			}
			return aggregate;
		}, {});
		const file = '/tmp/hosts.json';
		return fs.promises.writeFile(file, JSON.stringify(this.hosts));
	}
	configure_instance_in_region(region) {
		return this.copy_code_to_region(region)
			.then(this.copy_hosts_to_region.bind(this, region))
			.then(this.start_server.bind(this, region));
	}
	gather_logs_for_region(region) {
		return scp({
			host: this.hosts[region],
			port: 22,
			username: 'ec2-user',
			privateKey: fs.readFileSync(`/tmp/${region}.pem`)
		})
			.then((client) => {
				return client.downloadFile('/home/ec2-user/test-output.json.log', `/tmp/${region}-test.log`)
					.then((response) => {
						client.close();
						this.test_logs = this.test_logs || {};
						this.test_logs[region] = fs.readFileSync(`/tmp/${region}-test.log`).toString().split(/\n/).map((line) => {
							if (!line) {
								return {};
							}
							let parsed;
							try {
								parsed = JSON.parse(line);
							}
							catch(error) {
								console.warn("COULD NTO PARSE:", error);
								return {};
							}
							return parsed;
						});
					});
			});
	}
	copy_code_to_region(region) {
		return scp({
			host: this.hosts[region],
			port: 22,
			username: 'ec2-user',
			privateKey: fs.readFileSync(`/tmp/${region}.pem`)
		})
			.then((client) => {
				return client.uploadDir(`${__dirname}/../ec2-src`, '/home/ec2-user')
					.then((response) => {
						console.log("Copied code", region, this.hosts[region]);
						client.close();
					});
			});
	}
	copy_hosts_to_region(region) {
		return scp({
			host: this.hosts[region],
			port: 22,
			username: 'ec2-user',
			privateKey: fs.readFileSync(`/tmp/${region}.pem`)
		})
			.then((client) => {
				return client.uploadFile('/tmp/hosts.json', '/home/ec2-user/hosts.json')
					.then((response) => {
						console.log("Copied hosts.json", region, this.hosts[region]);
						client.close();
					});
				});
	}
	start_server(region) {
		return new Promise((resolve, reject) => {
			const command = `ssh -o StrictHostKeyChecking=no ec2-user@${this.hosts[region]} -i /tmp/${region}.pem 'bash ~/bin/setup.sh > ~/setup.log 2>&1 &'`;
			console.log("RUNNING:", region, command);
			child_process.exec(command, (error, stdout, stderr) => {
				if (error) {
					return reject(error);
				}
				console.log("Finished, stdout:", region, stdout);
				console.warn("Stderr:", region, stderr);
				return resolve();
			});
		});
	}
	find_ami_for_region(region) {
		if (
			this.instance_status &&
			this.instance_status[region] &&
			this.instance_status[region].Reservations &&
			this.instance_status[region].Reservations.length
		) {
			return;
		}
		const params = {
			Filters: [
				{ Name: 'architecture', Values: ['x86_64'] },
				{ Name: 'state', Values: ['available'] },
				{ Name: 'virtualization-type', Values: ['hvm'] },
				{ Name: 'name', Values: ['amzn2-ami-hvm-2.0.20210326.0-x86_64-gp2'] }
			],
			Owners: ['amazon']
		};
		return this.aws_ec2s[region].describeImages(params).promise()
			.then((result) => {
				if (result && result.Images && result.Images.length) {
					this.amis[region] = result.Images[0].ImageId;
				}
			});
	}
	cleanup_key_pair_in_region(region) {
		return this.aws_ec2s[region].deleteKeyPair({
			KeyName: `regional-test-${region}`
		}).promise()
			.then((result) => {
				console.log('Key Pair deleted', region);
				const file = `/tmp/${region}.pem`;
				return fs.promises.unlink(file)
					.catch((error) => {
						console.warn('No file to remove', region);
						delete this.key_pairs[region];
					});
			});
	}
	get_all_instance_ids(region) {
		const created_instance_ids = (
			this.created_instances &&
			this.created_instances[region] &&
			this.created_instances[region].Instances ?
				this.created_instances[region].Instances : []
		).reduce((aggregate, instance) => {
			aggregate.push(instance.InstanceId);
			return aggregate;
		}, []);
		const running_instance_ids = (
			this.instance_status &&
			this.instance_status[region] &&
			this.instance_status[region].Reservations ?
				this.instance_status[region].Reservations : []
		).reduce((aggregate, reservation) => {
			if (reservation.Instances) {
				reservation.Instances.forEach((instance) => {
					aggregate.push(instance.InstanceId);
				});
			}
			return aggregate;
		}, []);
		return created_instance_ids.concat(running_instance_ids);
	}
	cleanup_instances_in_region(region) {
		const instance_ids = this.get_all_instance_ids(region);
		console.warn('cleaning:', region, instance_ids);
		if (!instance_ids.length) {
			return;
		}
		this.terminated_instance_ids = this.terminated_instance_ids || {};
		this.terminated_instance_ids[region] = (this.terminated_instance_ids[region] || []).concat(instance_ids);
		const params = { InstanceIds: instance_ids };
		return this.aws_ec2s[region].terminateInstances(params).promise()
			.then((result) => {
				console.warn('Terminated', region, result.TerminatingInstances.length);
				if (this.created_instances) {
					delete this.created_instances[region];
				}
				if (this.instance_status) {
					delete this.instance_status[region];
				}
			});
	}
	check_key_pair(region) {
		const params = { Filters }
		return this.aws_ec2s[region].describeKeyPairs(params).promise()
			.then((result) => {
				console.log('Key pairs for', region, result.KeyPairs.length);
				this.key_pairs[region] = result;
			});
	}
	create_key_pair(region) {
		const params = {
			KeyName: `regional-test-${region}`,
			TagSpecifications: [{
				ResourceType: 'key-pair',
				Tags: [{
					Key: 'test',
					Value: 'crossregion'
				}]
			}]
		};
		console.log('Creating Key Pair', region);
		return this.aws_ec2s[region].createKeyPair(params).promise()
			.then((result) => {
				this.created_key_pairs[region] = { KeyPairs: [result] };
				console.warn('Created Key Pair:', region, result);
				const file = `/tmp/${region}.pem`;
				return fs.promises.writeFile(file, result.KeyMaterial)
					.then(() => {
						return fs.promises.chmod(file, 0o400);
					});
			})
			.catch((error) => {
				console.warn("UNABLE TO CREATE KEYPAIR:", region, error);
			});
	}
	create_new_instance(region) {
		if (
			this.instance_status &&
			this.instance_status[region] &&
			this.instance_status[region].Reservations &&
			this.instance_status[region].Reservations.length
		) {
			console.warn("Skipping creation", region);
			return;
		}
		const params = {
			ImageId: this.amis[region],
			InstanceType: 't2.micro',
			KeyName: `regional-test-${region}`,
			MinCount: 1,
			MaxCount: 1,
			SecurityGroups: [`regional-test-security-group-${region}`]
		};
		return this.aws_ec2s[region].runInstances(params).promise()
			.then((result) => {
				console.warn("Instance Created:", region, result.Instances[0].InstanceId);
				this.created_instances[region] = result;
				return this.aws_ec2s[region].waitFor(
					'instanceExists',
					{ Filters: [{
						Name: 'instance-id',
						Values: [result.Instances[0].InstanceId]
					}]}
				).promise()
					.then(() => { return this.tag_instance(region, result); });
			});
	}
	tag_instance(region, instance) {
		const instance_id = instance.Instances[0].InstanceId;
		const params = {
			Resources: [instance_id],
			Tags: [{
				Key: 'test',
				Value: 'crossregion'
			}]
		};
		return this.aws_ec2s[region].createTags(params).promise()
			.then((result) => {
				console.log('Instance tagged:', region, instance_id, result);
			});
	}
	check_instance_status_in_region(region) {
		const params = { 
			Filters: Filters.concat([{
				Name: 'instance-state-name',
				Values: ['pending', 'running']
			}])
		};
		return this.aws_ec2s[region].describeInstances(params).promise()
			.then((result) => {
				this.instance_status[region] = result;
			});
	}
	for_all_regions(method) {
		return Object.keys(this.aws_ec2s).reduce((aggregate, region) => {
			return aggregate.then(() => {
				return method(region);
			});
		}, Promise.resolve());
	}
};

module.exports = Builder;
