'use strict';

var _ = require('lodash');
var async = require('async');
var fs = require('fs-extra');
var globby = require('globby');
var npmKeyword = require('npm-keyword');
var packageJson = require('package-json');
var path = require('path');
var spawn = require('cross-spawn');

module.exports = {
	find: function(config, cb) {
		if (_.isUndefined(cb)) {
			cb = config;

			config = {};
		}

		var globalModules = _.isUndefined(config.globalModules)
			? true
			: config.globalModules;

		config.keyword = config.keyword || 'liferay-theme';
		config.version = config.version || '*';

		var searchFn = globalModules
			? this._searchGlobalModules
			: this._searchNpm;

		searchFn.call(this, config, cb);
	},

	name: function(name, cb) {
		this._getPackageJSON(
			{
				name: name,
			},
			function(err, pkg) {
				if (
					(pkg && !pkg.liferayTheme) ||
					(pkg && !_.includes(pkg.keywords, 'liferay-theme'))
				) {
					pkg = null;

					err = new Error(
						'Package is not a Liferay theme or themelet module'
					);
				}

				cb(err, pkg);
			}
		);
	},

	_findThemeModulesIn: function(paths) {
		var modules = [];

		_.forEach(paths, function(rootPath) {
			if (!rootPath) {
				return;
			}

			modules = globby
				.sync(['*-theme', '*-themelet'], {
					cwd: rootPath,
				})
				.map(function(match) {
					return path.join(rootPath, match);
				})
				.concat(modules);
		});

		return modules;
	},

	_getNpmPaths: function() {
		var paths = [];

		var win32 = process.platform === 'win32';

		_.forEach(path.join(process.cwd(), '..').split(path.sep), function(
			part,
			index,
			parts
		) {
			var lookup = path.join.apply(
				path,
				parts.slice(0, index + 1).concat(['node_modules'])
			);

			if (!win32) {
				lookup = '/' + lookup;
			}

			paths.push(lookup);
		});

		if (process.env.NODE_PATH) {
			paths = _.compact(
				process.env.NODE_PATH.split(path.delimiter)
			).concat(paths);
		} else {
			var results = spawn.sync('npm', ['root', '-g']);

			if (!results.error && results.stdout) {
				var npmRoot = results.stdout.toString();

				if (npmRoot) {
					paths.push(_.trim(npmRoot));
				}
			}

			if (win32) {
				paths.push(path.join(process.env.APPDATA, 'npm/node_modules'));
			} else {
				paths.push('/usr/lib/node_modules');
				paths.push('/usr/local/lib/node_modules');
			}
		}

		return paths.reverse();
	},

	_getPackageJSON: function(theme, cb) {
		packageJson(theme.name, '*', function(err, pkg) {
			if (err) {
				cb(err);

				return;
			}

			cb(null, pkg);
		});
	},

	_isLiferayThemeModule: function(pkg, themelet) {
		var retVal = false;

		if (pkg) {
			var liferayTheme = pkg.liferayTheme;

			if (!liferayTheme) {
				return retVal;
			}

			retVal =
				liferayTheme &&
				(themelet ? liferayTheme.themelet : !liferayTheme.themelet);
		}

		return retVal;
	},

	_matchesSearchTerms: function(pkg, searchTerms) {
		var description = pkg.description;

		return (
			pkg.name.indexOf(searchTerms) > -1 ||
			(description && description.indexOf(searchTerms) > -1)
		);
	},

	_reduceModuleResults: function(modules, config) {
		var instance = this;

		var searchTerms = config.searchTerms;
		var themelet = config.themelet;

		return _.reduce(
			modules,
			function(result, item) {
				var valid = false;

				if (
					instance._isLiferayThemeModule(item, themelet) &&
					instance._validateVersion(item, config.version)
				) {
					valid = true;
				}

				if (searchTerms && valid) {
					valid = instance._matchesSearchTerms(item, searchTerms);
				}

				if (valid) {
					result[item.name] = item;
				}

				return result;
			},
			{}
		);
	},

	_searchGlobalModules: function(config, cb) {
		var instance = this;

		var modules = this._findThemeModulesIn(this._getNpmPaths());

		modules = _.reduce(
			modules,
			function(result, item) {
				try {
					var json = require(path.join(item, 'package.json'));

					json.realPath = item;

					result.push(json);
				} catch (err) {}

				return result;
			},
			[]
		);

		cb(null, instance._reduceModuleResults(modules, config));
	},

	_searchNpm: function(config, cb) {
		var instance = this;

		npmKeyword(config.keyword).then(function(packages) {
			async.map(packages, instance._getPackageJSON, function(
				err,
				results
			) {
				if (err) {
					cb(err);

					return;
				}

				var themeResults = instance._reduceModuleResults(
					results,
					config
				);

				cb(err, themeResults);
			});
		});
	},

	_validateVersion: function(pkg, version) {
		var liferayThemeVersion = pkg.liferayTheme.version;
		var valid = false;

		if (
			version === '*' ||
			liferayThemeVersion === version ||
			(_.isArray(version) && _.includes(version, liferayThemeVersion)) ||
			(_.isArray(liferayThemeVersion) &&
				_.includes(liferayThemeVersion, version)) ||
			_.intersection(version, liferayThemeVersion).length
		) {
			valid = true;
		}

		return valid;
	},
};
