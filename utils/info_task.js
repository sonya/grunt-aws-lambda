'use strict';

/*
 * grunt-aws-lambda
 * https://github.com/Tim-B/grunt-aws-lambda
 *
 * Copyright (c) 2014 Tim-B
 * Licensed under the MIT license.
 */

var AWS = require('aws-sdk');
var arnParser = require('./arn_parser');

var infoTask = {};

var proxy = require('proxy-agent');

require('dotenv').config();

infoTask.getHandler = function (grunt) {

    return function () {
        var options = this.options({
            profile: null,
            RoleArn: null,
            accessKeyId: null,
            secretAccessKey: null,
            credentialsJSON: null,
            region: 'us-east-1'
        });

        //Adding proxy if exists
        if(process.env.https_proxy !== undefined) {
            AWS.config.update({
                httpOptions: { agent: proxy(process.env.https_proxy) }
            });
        }

        if (options.RoleArn !== null) {
            AWS.config.credentials = new AWS.EC2MetadataCredentials({
                httpOptions: {timeout: 5000} // 5 second timeout
            });
            AWS.config.credentials = new AWS.TemporaryCredentials({
                RoleArn: options.RoleArn
            });
        }

        if (options.accessKeyId !== null && options.secretAccessKey !== null) {
            AWS.config.update({accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey});
        }

        if (options.credentialsJSON !== null) {
            AWS.config.loadFromPath(options.credentialsJSON);
        }

        if (typeof options.aliases === 'string') {
            options.aliases = [options.aliases];
        }

        var deploy_function = grunt.config.get('lambda_deploy.' + this.target + '.function');
        var deploy_arn = grunt.config.get('lambda_deploy.' + this.target + '.arn');

        if (deploy_arn === null && deploy_function === null) {
            grunt.fail.warn('You must specify either an arn or a function name.');
        }

        if (deploy_arn) {
            deploy_function = deploy_arn;
            var functionInfo = arnParser.parse(deploy_arn);
            if (functionInfo && functionInfo.region) {
                options.region = functionInfo.region;
            }
        }

        AWS.config.update({region: options.region});

        var done = this.async();

        var lambda = new AWS.Lambda({
            apiVersion: '2015-03-31'
        });

        lambda.listVersionsByFunction({FunctionName: deploy_function}, function (err, data) {
            if (err) {
                if (err.statusCode === 404) {
                    grunt.fail.warn('Unable to find lambda function ' + deploy_function + ', verify the lambda function name and AWS region are correct.');
                } else {
                    grunt.log.error('AWS API request failed with ' + err.statusCode + ' - ' + err);
                    grunt.fail.warn('Check your AWS credentials, region and permissions are correct.');
                }
            }

            var lastVersion;
            var gruntDeployDescription = /from artifact ([\w_\-]+)/;
            for (var i = 0; i < data.Versions.length; i++) {
                lastVersion = data.Versions[i];

                var message = 'Version ' + lastVersion.Version +
                    ' deployed ' + lastVersion.LastModified;

                var match = gruntDeployDescription.exec(lastVersion.Description);
                if (match != null) {
                    var artifact = match[1];
                    message += ' @ ' + artifact;
                }

                grunt.log.writeln(message);
            }

            // latest version
            grunt.log.writeln('Latest version config:');
            grunt.log.writeln('    Runtime: ' + lastVersion.Runtime);
            grunt.log.writeln('    CodeSize: ' + lastVersion.CodeSize);
            grunt.log.writeln('    Timeout: ' + lastVersion.Timeout);
            grunt.log.writeln('    MemorySize: ' + lastVersion.MemorySize);
            grunt.log.writeln('    VpcConfig: ' + JSON.stringify(lastVersion.VpcConfig));
            grunt.log.writeln('    KMSKeyArn: ' + lastVersion.KMSKeyArn);

            if ('Environment' in lastVersion && 'Variables' in lastVersion.Environment) {
                grunt.log.writeln('    Environment Variables:');
                for (var envVar in lastVersion.Environment.Variables) {
                    var value = lastVersion.Environment.Variables[envVar];
                    grunt.log.writeln('        ' + envVar + ': ' + value);
                }
            }
        });
    };
};

module.exports = infoTask;
