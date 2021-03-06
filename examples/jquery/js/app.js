/*global jQuery, Handlebars, Router */
jQuery(function ($) {
	'use strict';

	Handlebars.registerHelper('eq', function (a, b, options) {
		return a === b ? options.fn(this) : options.inverse(this);
	});

	Handlebars.registerHelper('negative', function (num, options) {
		return num < 0 ? options.fn(this) : options.inverse(this);
	});

	Handlebars.registerHelper('pretty-date', function (seconds) {
		var seconds = Math.abs(seconds);
		var minutes = Math.ceil(seconds / 60);

		if (seconds < 60) {
			return seconds + ' ' + util.pluralize(seconds, 'second');
		}

		return minutes + ' ' + util.pluralize(minutes, 'minute');
	});

	var ENTER_KEY = 13;
	var ESCAPE_KEY = 27;

	var TICKING_SOUND_FILE = '../../media/ticking.m4a';
	var ALARM_SOUND_FILE = '../../media/alarm.m4a';

	var UPDATE_INTERVAL = 1000;
	var TICKING_THRESHOLD = 60;

	var util = {
		uuid: function () {
			/*jshint bitwise:false */
			var i, random;
			var uuid = '';

			for (i = 0; i < 32; i++) {
				random = Math.random() * 16 | 0;
				if (i === 8 || i === 12 || i === 16 || i === 20) {
					uuid += '-';
				}
				uuid += (i === 12 ? 4 : (i === 16 ? (random & 3 | 8) : random)).toString(16);
			}

			return uuid;
		},
		pluralize: function (count, word) {
			return count === 1 ? word : word + 's';
		},
		store: function (namespace, data) {
			if (arguments.length > 1) {
				return localStorage.setItem(namespace, JSON.stringify(data));
			} else {
				var store = localStorage.getItem(namespace);
				return (store && JSON.parse(store)) || [];
			}
		}
	};

	var App = {
		init: function () {
			this.todos = util.store('todos-jquery');
			this.todoTemplate = Handlebars.compile($('#todo-template').html());
			this.footerTemplate = Handlebars.compile($('#footer-template').html());
			this.deadlineTemplate = Handlebars.compile($('#deadline-template').html());
			this.$list = $('#todo-list');

			this.tickingSound = new Audio(TICKING_SOUND_FILE);
			this.tickingSound.loop = true;

			this.bindEvents();

			new Router({
				'/:filter': function (filter) {
					this.filter = filter;
					this.render();
				}.bind(this)
			}).init('/all');
		},
		bindEvents: function () {
			$('#new-todo').on('keyup', this.create.bind(this));
			$('#toggle-all').on('change', this.toggleAll.bind(this));
			$('#footer').on('click', '#clear-completed', this.destroyCompleted.bind(this));
			this.$list
				.on('change', '.toggle', this.toggle.bind(this))
				.on('dblclick', 'label', this.edit.bind(this))
				.on('keyup', '.edit', this.editKeyup.bind(this))
				.on('focusout', '.edit', this.update.bind(this))
				.on('click', '.destroy', this.destroy.bind(this))

				// Set deadline
				.on('keyup', '.deadline-input', this.editDeadline.bind(this))

				// Drag and Drop support
				.on('dragstart', 'li', this.handleDragStart.bind(this))
				.on('dragover', 'li', this.handleDragOver.bind(this))
				.on('drop', 'li', this.handleDrop.bind(this))
				.on('dragend', 'li', this.handleDragEnd.bind(this));
		},
		toggleReorder: function() {
			this.$list.children().prop('draggable', this.filter === 'all');
		},
		handleDrop: function (e) {

			var sourceEl = this.sourceDragEl;
			var targetEl = e.currentTarget;

			if (sourceEl === targetEl) {
				return;
			}

			var cursorY = e.originalEvent.pageY;
			var targetY = $(targetEl).offset().top;
			var targetCenter = targetEl.offsetHeight / 2;

			e.preventDefault();

			if (cursorY > targetY + targetCenter) {
				$(targetEl).after(sourceEl);
			}
			else {
				$(targetEl).before(sourceEl);
			}

			this.reorderList();
		},
		handleDragOver: function (e) {
			e.preventDefault();
		},
		handleDragStart: function (e) {
			this.sourceDragEl = e.currentTarget;

			$(e.currentTarget).addClass('dragging');
		},
		handleDragEnd: function() {
			$(this.sourceDragEl).removeClass('dragging');
		},
		editDeadline: function(e) {

			if (e.which !== ENTER_KEY) {
				return;
			}

			var minutes = parseInt(e.target.value, 10);
			var todo = this.todos[this.indexFromEl(e.target)];

			todo.deadline = minutes ? Date.now() + minutes * 60 * 1000 : 0;
			this.render();
		},
		reorderList: function() {
			this.todos = $.map(this.$list.children(), function(el) {
				return this.todos[this.indexFromEl(el)];
			}.bind(this));

			util.store('todos-jquery', this.todos);
		},
		render: function () {
			var todos = this.getFilteredTodos();
			$('#todo-list').html(this.todoTemplate(todos));
			$('#main').toggle(todos.length > 0);
			$('#toggle-all').prop('checked', this.getActiveTodos().length === 0);
			this.renderFooter();
			this.renderDeadline();
			$('#new-todo').focus();
			util.store('todos-jquery', this.todos);
			this.toggleReorder();
		},
		renderFooter: function () {
			var todoCount = this.todos.length;
			var activeTodoCount = this.getActiveTodos().length;
			var template = this.footerTemplate({
				activeTodoCount: activeTodoCount,
				activeTodoWord: util.pluralize(activeTodoCount, 'item'),
				completedTodos: todoCount - activeTodoCount,
				filter: this.filter
			});

			$('#footer').toggle(todoCount > 0).html(template);
		},
		renderDeadline: function () {
			var now = Date.now();
			var playAlertSound = false;

			$.each(this.getDeadlineTodos(), function(idx, todo) {

				var secondsLeft = Math.ceil((todo.deadline - now) / 1000);
				var templateOptions = {
					secondsLeft: secondsLeft,
					secondsWord: util.pluralize(secondsLeft, 'second')
				};

				if (secondsLeft < 0) {
					templateOptions.extraClass = 'overdue';
				}
				else if (secondsLeft <= TICKING_THRESHOLD) {
					playAlertSound = true;
					templateOptions.extraClass = 'alert';
				}

				if (secondsLeft === 0) {
					(new Audio(ALARM_SOUND_FILE)).play();
				}

				$('[data-id="' + todo.id + '"] .deadline-info').html(App.deadlineTemplate(templateOptions));

			});

			if (playAlertSound) {
				this.tickingSound.play();
			}
			else {
				this.tickingSound.pause();
			}

			setTimeout($.proxy(this.renderDeadline, this), UPDATE_INTERVAL);

		},
		toggleAll: function (e) {
			var isChecked = $(e.target).prop('checked');

			this.todos.forEach(function (todo) {
				todo.completed = isChecked;
			});

			this.render();
		},
		getDeadlineTodos: function() {
			return this.todos.filter(function (todo) {
				return todo.deadline && !todo.completed;
			});
		},
		getActiveTodos: function () {
			return this.todos.filter(function (todo) {
				return !todo.completed;
			});
		},
		getCompletedTodos: function () {
			return this.todos.filter(function (todo) {
				return todo.completed;
			});
		},
		getFilteredTodos: function () {
			if (this.filter === 'active') {
				return this.getActiveTodos();
			}

			if (this.filter === 'completed') {
				return this.getCompletedTodos();
			}

			return this.todos;
		},
		destroyCompleted: function () {
			this.todos = this.getActiveTodos();
			this.filter = 'all';
			this.render();
		},
		// accepts an element from inside the `.item` div and
		// returns the corresponding index in the `todos` array
		indexFromEl: function (el) {
			var id = $(el).closest('li').data('id');
			var todos = this.todos;
			var i = todos.length;

			while (i--) {
				if (todos[i].id === id) {
					return i;
				}
			}
		},
		create: function (e) {
			var $input = $(e.target);
			var val = $input.val().trim();

			if (e.which !== ENTER_KEY || !val) {
				return;
			}

			this.todos.push({
				id: util.uuid(),
				title: val,
				completed: false
			});

			$input.val('');

			this.render();
		},
		toggle: function (e) {
			var i = this.indexFromEl(e.target);
			this.todos[i].completed = !this.todos[i].completed;
			this.render();
		},
		edit: function (e) {
			var $input = $(e.target).closest('li').addClass('editing').find('.edit');
			$input.val($input.val()).focus();
		},
		editKeyup: function (e) {
			if (e.which === ENTER_KEY) {
				e.target.blur();
			}

			if (e.which === ESCAPE_KEY) {
				$(e.target).data('abort', true).blur();
			}
		},
		update: function (e) {
			var el = e.target;
			var $el = $(el);
			var val = $el.val().trim();

			if (!val) {
				this.destroy(e);
				return;
			}

			if ($el.data('abort')) {
				$el.data('abort', false);
			} else {
				this.todos[this.indexFromEl(el)].title = val;
			}

			this.render();
		},
		destroy: function (e) {
			this.todos.splice(this.indexFromEl(e.target), 1);
			this.render();
		}
	};

	App.init();
});
