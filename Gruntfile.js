module.exports = function (grunt) {
	'use strict';

	grunt.initConfig({
		pkg: grunt.file.readJSON('package.json'),
		cssmin: {
			dist: {
				src: ['assets/css/master.css'],
				dest: 'assets/css/all.min.css'
			}
		},
		uglify: {
			my_target: {
				files: {
					'assets/js/all.min.js': ['assets/js/easteregg.js']
				}
			}
		}
	});

	grunt.loadNpmTasks('grunt-contrib-cssmin');
	grunt.loadNpmTasks('grunt-contrib-uglify');

	// Default task(s).
	grunt.registerTask('default', ['cssmin', 'uglify']);

}
