let rbql_suggest = {};

( function() {

rbql_suggest.active_suggest_idx = null; 
rbql_suggest.suggest_list = []
rbql_suggest.apply_suggest_callback = null;


function generate_autosuggest_variables(header) {
    let result = [];
    for (let h of header) {
        if (h.match('^[_a-zA-Z][_a-zA-Z0-9]*$') !== null) {
            result.push(`a.${h}`);
        }
        let escaped_column_name = js_string_escape_column_name(h, '"');
        result.push(`a["${escaped_column_name}"]`);
        escaped_column_name = js_string_escape_column_name(h, "'");
        result.push(`a['${escaped_column_name}']`);
    }
    return result;
}


function hide_suggest(suggest_div) {
    if (rbql_suggest.active_suggest_idx !== null) {
        suggest_div.style.display = 'none';
        rbql_suggest.active_suggest_idx = null;
        rbql_suggest.suggest_list = [];
    }
}


function apply_suggest(suggest_index) {
    try {
        let rbql_input = document.getElementById('rbql_input');
        rbql_input.value = rbql_suggest.suggest_list[suggest_index][0];
        rbql_input.selectionStart = rbql_suggest.suggest_list[suggest_index][1];
        rbql_input.selectionEnd = rbql_suggest.suggest_list[suggest_index][1];
        rbql_input.focus();
        if (rbql_suggest.apply_suggest_callback) {
            rbql_suggest.apply_suggest_callback(rbql_suggest.suggest_list[suggest_index][0]);
        }
        hide_suggest(document.getElementById('query_suggest'));
    } catch (e) {
        console.error(`Autocomplete error: ${e}`);
    }
}


function register_suggest_callback(button_element, suggest_index) {
    button_element.addEventListener("click", () => {
        apply_suggest(suggest_index);
    });
}


function highlight_suggest_entry(suggest_idx, do_highlight) {
    // FIXME we don't need suggest_idx variable here - use rbql_suggest.active_suggest_idx instead
    let entry_button = document.getElementById(`rbql_suggest_var_${suggest_idx}`);
    if (!entry_button)
        return;
    if (do_highlight) {
        entry_button.className = 'history_button history_button_active';
    } else {
        entry_button.className = 'history_button';
    }
}


function show_suggest(suggest_div, query_before_var, relevant_suggest_list, query_after_cursor) {
    let rbql_input = document.getElementById('rbql_input');
    let text_input_coordinates = get_coordinates(rbql_input);
    let caret_left_shift = 0;
    try {
        let caret_coordinates = getCaretCoordinates(rbql_input, rbql_input.selectionStart);
        caret_left_shift = caret_coordinates.left ? caret_coordinates.left : 0;
    } catch (e) {
        caret_left_shift = 0;
    }
    remove_children(suggest_div);
    rbql_suggest.active_suggest_idx = 0;
    rbql_suggest.suggest_list = [];
    for (let i = 0; i < relevant_suggest_list.length; i++) {
        let suggest_text = relevant_suggest_list[i];
        let entry_button = document.createElement('button');
        entry_button.className = 'history_button';
        entry_button.textContent = suggest_text;
        entry_button.setAttribute('id', `rbql_suggest_var_${i}`);
        register_suggest_callback(entry_button, i);
        suggest_div.appendChild(entry_button);
        rbql_suggest.suggest_list.push([query_before_var + suggest_text + query_after_cursor, (query_before_var + suggest_text).length]);
    }
    highlight_suggest_entry(rbql_suggest.active_suggest_idx, true);
    suggest_div.style.display = 'block';
    let calculated_height = suggest_div.scrollHeight;
    suggest_div.style.left = (text_input_coordinates.left + caret_left_shift) + 'px';
    suggest_div.style.top = (text_input_coordinates.top - calculated_height) + 'px';
}


function switch_active_suggest(direction) {
    if (rbql_suggest.active_suggest_idx === null)
        return false;
    highlight_suggest_entry(rbql_suggest.active_suggest_idx, false);
    if (direction == 'up') {
        rbql_suggest.active_suggest_idx = (rbql_suggest.active_suggest_idx + rbql_suggest.suggest_list.length - 1) % rbql_suggest.suggest_list.length;
    } else {
        rbql_suggest.active_suggest_idx = (rbql_suggest.active_suggest_idx + 1) % rbql_suggest.suggest_list.length;
    }
    highlight_suggest_entry(rbql_suggest.active_suggest_idx, true);
    return true;
}


function is_printable_key_code(keycode) {
    // Taken from here: https://stackoverflow.com/a/12467610/2898283
    return (keycode > 47 && keycode < 58) || keycode == 32 || (keycode > 64 && keycode < 91) || (keycode > 185 && keycode < 193) || (keycode > 218 && keycode < 223);
}


function handle_input_keydown(event) {
    // We need this logic to prevent the caret from going to the start of the input field with the default arrow-up keydown handler
    try {
        if (event.keyCode == 38) {
            if (switch_active_suggest('up'))
                event.preventDefault();
        } else if (event.keyCode == 40) {
            if (switch_active_suggest('down'))
                event.preventDefault();
        } else if (event.keyCode == 39) {
            if (rbql_suggest.active_suggest_idx !== null) {
                apply_suggest(rbql_suggest.active_suggest_idx);
                event.preventDefault();
            }
        }
    } catch (e) {
        console.error(`Autocomplete error: ${e}`);
    }
}


function handle_input_keyup(event) {
    try {
        if (event.keyCode == 13) {
            if (rbql_suggest.active_suggest_idx !== null)
                apply_suggest(rbql_suggest.active_suggest_idx);
            return;
        }
        if (is_printable_key_code(event.keyCode) || event.keyCode == 8 /* Bakspace */) {
            // We can't move this into the keydown handler because the characters appear in the input box only after keyUp event.
            // Or alternatively we could scan the event.keyCode to find out the next char, but this is additional logic
            let rbql_input = document.getElementById('rbql_input');
            let current_query = rbql_input.value;
            let suggest_div = document.getElementById('query_suggest');
            hide_suggest(suggest_div);
            let cursor_pos = rbql_input.selectionStart;
            let query_before_cursor = current_query.substr(0, cursor_pos);
            let query_after_cursor = current_query.substr(cursor_pos);
            let last_var_prefix_match = query_before_cursor.match(/(?:[^_a-zA-Z0-9])([ab](?:\.[_a-zA-Z0-9]*|\[[^\]]*))$/);
            if (last_var_prefix_match) {
                let relevant_suggest_list = [];
                let last_var_prefix = last_var_prefix_match[1];
                let query_before_var = query_before_cursor.substr(0, last_var_prefix_match.index + 1);
                for (let hv of autosuggest_header_vars) {
                    if (last_var_prefix === 'a[' && hv.startsWith('a["'))
                        continue; // Don't match both a['...'] and a["..."] notations of the same variable
                    if (hv.toLowerCase().startsWith(last_var_prefix.toLowerCase()) && hv != last_var_prefix)
                        relevant_suggest_list.push(hv);
                }
                if (relevant_suggest_list.length) {
                    show_suggest(suggest_div, query_before_var, relevant_suggest_list, query_after_cursor);
                }
            }
        }
    } catch (e) {
        console.error(`Autocomplete error: ${e}`);
    }
}

function set_apply_suggest_callback(apply_suggest_callback) {
    rbql_suggest.apply_suggest_callback = apply_suggest_callback;
}


rbql_suggest.set_apply_suggest_callback = set_apply_suggest_callback;
rbql_suggest.generate_autosuggest_variables = generate_autosuggest_variables;
rbql_suggest.handle_input_keydown = handle_input_keydown;
rbql_suggest.handle_input_keyup = handle_input_keyup;

} )();
