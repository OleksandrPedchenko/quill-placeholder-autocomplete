import { h } from './utils';
import getSuggestBlot from './suggestBlot';

export default (Quill) => {
  const Delta = Quill.import('delta');

  Quill.register('formats/suggest', getSuggestBlot(Quill));

  /**
 * Quill Autocomplete for placeholder module
 * @export
 * @class AutoComplete
 */
  class AutoComplete {
    /**
     * Creates an instance of AutoComplete.
     * @param {any} quill the Quill instance
     * @param {Object} options module options
     * @memberof AutoComplete
     */
    constructor(quill, { onClose, onOpen, getPlaceholders, container, triggerKey = '#' }) {
      this.quill = quill;
      this.onClose = onClose;
      this.onOpen = onOpen;
      this.getPlaceholders = getPlaceholders;
      this.triggerKey = triggerKey;
      if (typeof container === 'string') {
        this.container = this.quill.container.parentNode.querySelector(container);
      } else if (container === undefined) {
        this.container = h('ul', {});
        this.quill.container.parentNode.appendChild(this.container);
      } else {
        this.container = container;
      }
      this.container.classList.add('ql-autocomplete-menu1', 'completions');
      this.container.style.position = 'absolute';
      this.container.style.display = 'none';

      this.onSelectionChange = this.maybeUnfocus.bind(this);
      this.onTextChange = this.update.bind(this);

      this.open = false;
      this.quill.suggestsDialogOpen = false;
      this.hashIndex = null;
      this.focusedButton = null;
      this.buttons = [];
      this.placeholders = [];
      this.toolbarHeight = 0;

      // TODO: Once Quill supports using event.key (issue #1091) use that instead of alt-3
      // quill.keyboard.addBinding({
      //   key: 51,  // '3' keyCode
      //   altKey: true,
      //   ctrlKey: null // both
      // }, this.onHashKey.bind(this));

      quill.root.addEventListener('keydown', (event) => {
        if (event.defaultPrevented)
          return; // Do nothing if the event was already processed

        if (event.key === this.triggerKey) {
          if (!this.toolbarHeight)
            this.toolbarHeight = this.quill.getModule('toolbar').container.offsetHeight;
          this.onHashKey(this.quill.getSelection());
        } else
          return; // Quit when this doesn't handle the key event.

        // Cancel the default action to avoid it being handled twice
        event.preventDefault();
      }, true);

      quill.keyboard.addBinding({
        key: 40,  // ArrowDown
        collapsed: true,
        format: [ 'suggest' ]
      }, this.handleArrow.bind(this));

      quill.keyboard.addBinding({
        key: 27,  // Escape
        collapsed: null,
        format: [ 'suggest' ]
      }, this.handleEscape.bind(this));

      quill.suggestHandler = this.onHashKey.bind(this);
    }

    /**
     * Called when user entered trigger key
     * prepare editor and open completions list
     * @param {Quill.RangeStatic} range concerned region
     * @param {any} context editor context
     * @returns {Boolean} can stop event propagation
     * @memberof AutoComplete
     */
    onHashKey(range, _) {
      // prevent from opening twice
      // NOTE: returning true stops event propagation in Quill
      if (this.open)
        return true;

      if (range.length > 0) {
        this.quill.deleteText(range.index, range.length, Quill.sources.USER);
      }
      // insert a temporary SuggestBlot
      this.quill.insertText(range.index, this.triggerKey, 'suggest', '@@placeholder', Quill.sources.USER);
      const hashSignBounds = this.quill.getBounds(range.index);
      this.quill.setSelection(range.index + 1, Quill.sources.SILENT);

      this.hashIndex = range.index;
      this.container.style.left = hashSignBounds.left + 'px';
      this.container.style.top = hashSignBounds.top + hashSignBounds.height + this.toolbarHeight + 2 + 'px';
      this.open = true;
      this.quill.suggestsDialogOpen = true;
      // binding completions event handler to handle user query
      this.quill.on('text-change', this.onTextChange);
      // binding event handler to handle user want to quit autocompletions
      this.quill.once('selection-change', this.onSelectionChange);
      this.quill.root.addEventListener('keydown', (event) => {
        if (event.key === 'Enter')
          this.handleEnterTab();
      }, { once: true });
      this.update();
      this.onOpen && this.onOpen();
    }

    /**
     * Called on first user interaction
     * with completions list on open
     * @returns {Boolean} eventually stop propagation
     * @memberof AutoComplete
     */
    handleArrow() {
      if (!this.open)
        return true;
      this.buttons[0].focus();
    }

    /**
     * Called on first user interaction
     * with completions list on open
     * @returns {Boolean} eventually stop propagation
     * @memberof AutoComplete
     */
    handleEnterTab() {
      if (!this.open)
        return true;
      this.close(this.placeholders[0]);
    }

    /**
     * Called on first user interaction
     * with completions list on open
     * @returns {Boolean} eventually stop propagation
     * @memberof AutoComplete
     */
    handleEscape() {
      if (!this.open)
        return true;
      this.close();
    }

    emptyCompletionsContainer() {
      // empty container completely
      while (this.container.firstChild)
        this.container.removeChild(this.container.firstChild);
    }

    /**
     * Completions updater
     * analyze user query && update list and DOM
     * @returns {any} eventually close list and quit function
     * @memberof AutoComplete
     */
    update() {
      const sel = this.quill.getSelection().index;
      // Deleted the at character
      if (this.hashIndex >= sel) {
        return this.close(null);
      }
      this.originalQuery = this.quill.getText(this.hashIndex + 1, sel - this.hashIndex - 1);
      this.query = this.originalQuery.toLowerCase();
      // TODO: Should use fuse.js or similar fuzzy-matcher
      this.placeholders = this.getPlaceholders()
        .filter(ph => ph.label.toLowerCase().startsWith(this.query))
        .sort((ph1, ph2) => ph1.label > ph2.label);
      this.renderCompletions(this.placeholders);
      this.quill.root.addEventListener('keydown', (event) => {
        if (event.key === 'Enter')
          this.handleEnterTab();
      }, { once: true });
    }

    /**
     * Called when user go somewhere else
     * than completion list => user changed focus
     * @memberof AutoComplete
     */
    maybeUnfocus() {
      if (this.container.querySelector('*:focus'))
        return;
      this.close(null);
    }

    /**
     * Render completions List
     * @param {Array} placeholders list of placeholders to propose
     * @memberof AutoComplete
     */
    renderCompletions(placeholders) {
      this.emptyCompletionsContainer();

      const buttons = Array(placeholders.length);
      this.buttons = buttons;
      /* eslint complexity: ["error", 13] */
      const handler = (i, placeholder) => (event) => {
        if (event.key === 'ArrowDown' || event.keyCode === 40) {
          event.preventDefault();
          buttons[Math.min(buttons.length - 1, i + 1)].focus();
        } else if (event.key === 'ArrowUp' || event.keyCode === 38) {
          event.preventDefault();
          buttons[Math.max(0, i - 1)].focus();
        } else if (event.key === 'Enter' || event.keyCode === 13
          || event.key === ' ' || event.keyCode === 32
          || event.key === 'Tab' || event.keyCode === 9) {
          event.preventDefault();
          this.close(placeholder);
        } else if (event.key === 'Escape' || event.keyCode === 27) {
          event.preventDefault();
          this.close();
        }
      };
      // prepare buttons corresponding to each placeholder
      placeholders.forEach((placeholder, i) => {
        const li = h('li', {},
          h('button', { type: 'button' },
            h('span', { className: 'matched' }, '{' + placeholder.label.slice(0, this.query.length)),
            h('span', { className: 'unmatched' }, placeholder.label.slice(this.query.length))));
        this.container.appendChild(li);
        buttons[i] = li.firstChild;
        // event handlers will be garbage-collected with button on each re-render
        buttons[i].addEventListener('keydown', handler(i, placeholder));
        buttons[i].addEventListener('mousedown', () => this.close(placeholder));
        buttons[i].addEventListener('focus', () => this.focusedButton = i);
        buttons[i].addEventListener('unfocus', () => this.focusedButton = null);
      });
      this.container.style.display = 'block';
    }

    /**
     * Adds appropriate placeholder if asked and close the list gracefully
     * @param {any} placeholder user chosen placeholder or null
     * @memberof AutoComplete
     */
    close(placeholder) {
      this.container.style.display = 'none';
      this.emptyCompletionsContainer();
      // detaching event handlers (user query finished)
      this.quill.off('selection-change', this.onSelectionChange);
      this.quill.off('text-change', this.onTextChange);
      const delta = new Delta()
        .retain(this.hashIndex)
        .delete(this.query.length + 1);
      // removing user query from before
      this.quill.updateContents(delta, Quill.sources.USER);
      if (placeholder) {
        this.quill.insertEmbed(this.hashIndex, 'placeholder', placeholder, Quill.sources.USER);
        this.quill.setSelection(this.hashIndex + 1, 0, Quill.sources.SILENT);
      }
      this.quill.focus();
      this.open = false;
      this.quill.suggestsDialogOpen = false;
      this.onClose && this.onClose(placeholder || null);
    }

  }

  return AutoComplete;
};

