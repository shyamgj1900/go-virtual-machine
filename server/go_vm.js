const { display, parse } = require("sicp");

Object.entries(require("sicp")).forEach(
  ([name, exported]) => (global[name] = exported)
);

// ************************************************************
// Virtual machine with tagged pointers for a sublanguage of Go
// set up for mark-and-sweep garbage collection
// ************************************************************/

// Implement Sleep
// const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function blockingSleep(ms) {
  const startTime = new Date().getTime();
  let currentTime = null;
  do {
    currentTime = new Date().getTime();
  } while (currentTime - startTime < ms);
}

// Output of program
OUTPUTS = [];

// **********************
// using arrays as stacks
// **********************/

// add values destructively to the end of
// given array; return the array
const push = (array, ...items) => {
  // fixed by Liew Zhao Wei, see Discussion 5
  for (let item of items) {
    array.push(item);
  }
  return array;
};

// return the last element of given array
// without changing the array
const peek = (array, address) => array.slice(-1 - address)[0];

// *************
// parse to JSON
// *************/

const list_to_array = (xs) =>
  is_null(xs) ? [] : [head(xs)].concat(list_to_array(tail(xs)));

// simplify parameter format
const parameters = (xs) => map((x) => head(tail(x)), xs);

// *************************
// HEAP
// *************************/

// HEAP is an array of bytes (JS ArrayBuffer)

const word_size = 8;

// heap_make allocates a heap of given size
// (in bytes) and returns a DataView of that,
// see https://www.javascripture.com/DataView
const heap_make = (words) => {
  const data = new ArrayBuffer(words * word_size);
  const view = new DataView(data);
  return view;
};

// for convenience, HEAP is global variable
// initialized in initialize_machine()
let HEAP;
let heap_size;

// free is the next free index in the free list
let free;

// for debugging: display all bits of the heap
const heap_display = (s) => {
  display("", "heap: " + s);
  for (let i = 0; i < heap_size; i++) {
    display(
      word_to_string(heap_get(i)),
      stringify(i) + " " + stringify(heap_get(i)) + " "
    );
  }
};

// heap_allocate allocates a given number of words
// on the heap and marks the first word with a 1-byte tag.
// the last two bytes of the first word indicate the number
// of children (addresses) that follow the tag word:
// [1 byte tag, 4 bytes payload (depending on node type),
//  2 bytes #children, 1 byte unused]
// Note: payload depends on the type of node
const size_offset = 5;

const node_size = 10;

const heap_allocate = (tag, size) => {
  if (size > node_size) {
    error("limitation: nodes cannot be larger than 10 words");
  }
  // a value of -1 in free indicates the
  // end of the free list
  if (free === -1) {
    display("GARBAGE COLLECTION");
    mark_sweep();
  }

  // allocate
  const address = free;
  free = heap_get(free);
  HEAP.setInt8(address * word_size, tag);
  HEAP.setUint16(address * word_size + size_offset, size);
  return address;
};

const mark_bit = 7;

const UNMARKED = 0;
const MARKED = 1;

let HEAP_BOTTOM;
let ALLOCATING;

const get_roots = () => {
  let root_os = [...OS];
  let root_E = [E];
  let root_RTS = [...RTS];
  for (const context of context_Q) {
    root_os.push(...context.OS);
    root_E.push(context.E);
    root_RTS.push(...context.RTS);
  }
  // for (const os of OS_Q) {
  //   root_os.push(...os);
  // }
  // for (const e of E_Q) {
  //   root_E.push(e);
  // }
  // for (const rts of RTS_Q) {
  //   root_RTS.push(...rts);
  // }

  return [...root_os, ...root_E, ...root_RTS, ...ALLOCATING];
};

const mark_sweep = () => {
  // mark r for r in roots
  const roots = get_roots();
  for (const element of roots) {
    mark(element);
  }

  sweep();

  if (free === -1) {
    error("heap memory exhausted");
    // or error("out of memory")
  }
};

const mark = (node) => {
  if (node >= heap_size) {
    return;
  }

  if (is_unmarked(node)) {
    heap_set_byte_at_offset(node, mark_bit, MARKED);

    const num_of_children = heap_get_number_of_children(node);

    for (let i = 0; i < num_of_children; i++) {
      mark(heap_get_child(node, i));
    }
  }
};

const sweep = () => {
  let v = HEAP_BOTTOM;

  while (v < heap_size) {
    if (is_unmarked(v)) {
      free_node(v);
    } else {
      heap_set_byte_at_offset(v, mark_bit, UNMARKED);
    }

    v = v + node_size;
  }
};

const is_unmarked = (node) =>
  heap_get_byte_at_offset(node, mark_bit) === UNMARKED;

const free_node = (node) => {
  // heap set is used for retrieving the next free node
  heap_set(node, free);
  free = node;
};

const heap_already_copied = (node) =>
  heap_get_forwarding_address(node) >= to_space &&
  heap_get_forwarding_address(node) <= free;

const heap_set_forwarding_address = (node, address) =>
  HEAP.setInt32(node * word_size, address);

const heap_get_forwarding_address = (node) => HEAP.getInt32(node * word_size);

// get and set a word in heap at given address
const heap_get = (address) => HEAP.getFloat64(address * word_size);

const heap_set = (address, x) => HEAP.setFloat64(address * word_size, x);

// child index starts at 0
const heap_get_child = (address, child_index) =>
  heap_get(address + 1 + child_index);

const heap_set_child = (address, child_index, value) =>
  heap_set(address + 1 + child_index, value);

const heap_get_tag = (address) => HEAP.getInt8(address * word_size);

const heap_get_mark_bit = (address) =>
  HEAP.getInt8(address * word_size + mark_offset);

// To indicate a node as marked
const heap_set_mark_bit = (address, x) =>
  HEAP.setInt8(address * word_size + mark_offset, x);

const heap_get_size = (address) =>
  HEAP.getUint16(address * word_size + size_offset);

// the number of children is one less than the size
// except for number nodes:
//                 they have size 2 but no children
const heap_get_number_of_children = (address) =>
  heap_get_tag(address) === Number_tag ? 0 : heap_get_size(address) - 1;

// access byte in heap, using address and offset
const heap_set_byte_at_offset = (address, offset, value) =>
  HEAP.setUint8(address * word_size + offset, value);

const heap_get_byte_at_offset = (address, offset) =>
  HEAP.getUint8(address * word_size + offset);

// access byte in heap, using address and offset
const heap_set_2_bytes_at_offset = (address, offset, value) =>
  HEAP.setUint16(address * word_size + offset, value);

const heap_get_2_bytes_at_offset = (address, offset) =>
  HEAP.getUint16(address * word_size + offset);

// for debugging: return a string that shows the bits
// of a given word
const word_to_string = (word) => {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, word);
  let binStr = "";
  for (let i = 0; i < 8; i++) {
    binStr += ("00000000" + view.getUint8(i).toString(2)).slice(-8) + " ";
  }
  return binStr;
};

// values

// All values are allocated on the heap as nodes. The first
// word of the node is a header, and the first byte of the
// header is a tag that identifies the type of node

const False_tag = 0;
const True_tag = 1;
const Number_tag = 2;
const Null_tag = 3;
const Unassigned_tag = 4;
const Undefined_tag = 5;
const Blockframe_tag = 6;
const Callframe_tag = 7;
const Closure_tag = 8;
const Frame_tag = 9; // 0000 1001
const Environment_tag = 10; // 0000 1010
const Pair_tag = 11;
const Builtin_tag = 12;

// all values (including literals) are allocated on the heap.

// We allocate canonical values for
// true, false, undefined, null, and unassigned
// and make sure no such values are created at runtime

// boolean values carry their value (0 for false, 1 for true)
// in the byte following the tag

let False;
const is_False = (address) => heap_get_tag(address) === False_tag;
let True;
const is_True = (address) => heap_get_tag(address) === True_tag;

const is_Boolean = (address) => is_True(address) || is_False(address);

let Null;
const is_Null = (address) => heap_get_tag(address) === Null_tag;

let Unassigned;
const is_Unassigned = (address) => heap_get_tag(address) === Unassigned_tag;

let Undefined;
const is_Undefined = (address) => heap_get_tag(address) === Undefined_tag;

const allocate_literal_values = () => {
  False = heap_allocate(False_tag, 1);
  True = heap_allocate(True_tag, 1);
  Null = heap_allocate(Null_tag, 1);
  Unassigned = heap_allocate(Unassigned_tag, 1);
  Undefined = heap_allocate(Undefined_tag, 1);
};

// builtins: builtin id is encoded in second byte
// [1 byte tag, 1 byte id, 3 bytes unused,
//  2 bytes #children, 1 byte unused]
// Note: #children is 0

const is_Builtin = (address) => heap_get_tag(address) === Builtin_tag;

const heap_allocate_Builtin = (id) => {
  const address = heap_allocate(Builtin_tag, 1);
  heap_set_byte_at_offset(address, 1, id);
  return address;
};

const heap_get_Builtin_id = (address) => heap_get_byte_at_offset(address, 1);

// closure
// [1 byte tag, 1 byte arity, 2 bytes pc, 1 byte unused,
//  2 bytes #children, 1 byte unused]
// followed by the address of env
// note: currently bytes at offset 4 and 7 are not used;
//   they could be used to increase pc and #children range

const heap_allocate_Closure = (arity, pc, env) => {
  ALLOCATING = [env];
  const address = heap_allocate(Closure_tag, 2);
  ALLOCATING = [];
  heap_set_byte_at_offset(address, 1, arity);
  heap_set_2_bytes_at_offset(address, 2, pc);
  heap_set(address + 1, env);
  return address;
};

const heap_get_Closure_arity = (address) => heap_get_byte_at_offset(address, 1);

const heap_get_Closure_pc = (address) => heap_get_2_bytes_at_offset(address, 2);

const heap_get_Closure_environment = (address) => heap_get_child(address, 0);

const is_Closure = (address) => heap_get_tag(address) === Closure_tag;

// block frame
// [1 byte tag, 4 bytes unused,
//  2 bytes #children, 1 byte unused]

const heap_allocate_Blockframe = (env) => {
  ALLOCATING = [env];
  const address = heap_allocate(Blockframe_tag, 2);
  heap_set(address + 1, env);
  ALLOCATING = [];
  return address;
};

const heap_get_Blockframe_environment = (address) => heap_get_child(address, 0);

const is_Blockframe = (address) => heap_get_tag(address) === Blockframe_tag;

// call frame
// [1 byte tag, 1 byte unused, 2 bytes pc,
//  1 byte unused, 2 bytes #children, 1 byte unused]
// followed by the address of env

const heap_allocate_Callframe = (env, pc) => {
  ALLOCATING = [env];
  const address = heap_allocate(Callframe_tag, 2);
  ALLOCATING = [];
  heap_set_2_bytes_at_offset(address, 2, pc);
  heap_set(address + 1, env);
  return address;
};

const heap_get_Callframe_environment = (address) => heap_get_child(address, 0);

const heap_get_Callframe_pc = (address) =>
  heap_get_2_bytes_at_offset(address, 2);

const is_Callframe = (address) => heap_get_tag(address) === Callframe_tag;

// environment frame
// [1 byte tag, 4 bytes unused,
//  2 bytes #children, 1 byte unused]
// followed by the addresses of its values

const heap_allocate_Frame = (number_of_values) =>
  heap_allocate(Frame_tag, number_of_values + 1);

const heap_Frame_display = (address) => {
  display("", "Frame:");
  const size = heap_get_number_of_children(address);
  display(size, "frame size:");
  for (let i = 0; i < size; i++) {
    display(i, "value address:");
    const value = heap_get_child(address, i);
    display(value, "value:");
    display(word_to_string(value), "value word:");
  }
};

// environment
// [1 byte tag, 4 bytes unused,
//  2 bytes #children, 1 byte unused]
// followed by the addresses of its frames

const heap_allocate_Environment = (number_of_frames, frame_address = Null) =>
  heap_allocate(Environment_tag, number_of_frames + 1, frame_address);

// access environment given by address
// using a "position", i.e. a pair of
// frame index and value index
const heap_get_Environment_value = (env_address, position) => {
  const [frame_index, value_index] = position;
  const frame_address = heap_get_child(env_address, frame_index);
  return heap_get_child(frame_address, value_index);
};

const heap_set_Environment_value = (env_address, position, value) => {
  const [frame_index, value_index] = position;
  const frame_address = heap_get_child(env_address, frame_index);
  heap_set_child(frame_address, value_index, value);
};

// extend a given environment by a new frame:
// create a new environment that is bigger by 1
// frame slot than the given environment.
// copy the frame Addresses of the given
// environment to the new environment.
// enter the address of the new frame to end
// of the new environment
const heap_Environment_extend = (frame_address, env_address, frame_alloc) => {
  const old_size = heap_get_size(env_address);
  // modified: should not free frame address and env address here
  ALLOCATING = [frame_address, env_address];
  const new_env_address = heap_allocate_Environment(old_size);
  ALLOCATING = [];
  let i;
  for (i = 0; i < old_size - 1; i++) {
    heap_set_child(new_env_address, i, heap_get_child(env_address, i));
  }
  heap_set_child(new_env_address, i, frame_address);
  return new_env_address;
};

// for debuggging: display environment
const heap_Environment_display = (env_address) => {
  const size = heap_get_number_of_children(env_address);
  display("", "Environment:");
  display(size, "environment size:");
  for (let i = 0; i < size; i++) {
    display(i, "frame index:");
    const frame = heap_get_child(env_address, i);
    heap_Frame_display(frame);
  }
};

// pair
// [1 byte tag, 4 bytes unused,
//  2 bytes #children, 1 byte unused]
// followed by head and tail addresses, one word each
const heap_allocate_Pair = (hd, tl) => {
  const pair_address = heap_allocate(Pair_tag, 3);
  heap_set_child(pair_address, 0, hd);
  heap_set_child(pair_address, 1, tl);
  return pair_address;
};

const is_Pair = (address) => heap_get_tag(address) === Pair_tag;

// number
// [1 byte tag, 4 bytes unused,
//  2 bytes #children, 1 byte unused]
// followed by the number, one word
// note: #children is 0

const heap_allocate_Number = (n) => {
  const number_address = heap_allocate(Number_tag, 2);
  heap_set(number_address + 1, n);
  return number_address;
};

const is_Number = (address) => heap_get_tag(address) === Number_tag;

//
// conversions between addresses and JS_value
//

const address_to_JS_value = (x) =>
  is_Boolean(x)
    ? is_True(x)
      ? true
      : false
    : is_Number(x)
    ? heap_get(x + 1)
    : is_Undefined(x)
    ? undefined
    : is_Unassigned(x)
    ? "<unassigned>"
    : is_Null(x)
    ? null
    : is_Pair(x)
    ? [
        address_to_JS_value(heap_get_child(x, 0)),
        address_to_JS_value(heap_get_child(x, 1)),
      ]
    : is_Closure(x)
    ? "<closure>"
    : is_Builtin(x)
    ? "<builtin>"
    : "unknown word tag: " + word_to_string(x);

const JS_value_to_address = (x) =>
  is_boolean(x)
    ? x
      ? True
      : False
    : is_number(x)
    ? heap_allocate_Number(x)
    : is_undefined(x)
    ? Undefined
    : is_null(x)
    ? Null
    : is_pair(x)
    ? heap_allocate_Pair(
        JS_value_to_address(head(x)),
        JS_value_to_address(tail(x))
      )
    : "unknown word tag: " + word_to_string(x);

// ************************
// compile-time environment
// ************************/

// a compile-time environment is an array of
// compile-time frames, and a compile-time frame
// is an array of symbols

// find the position [frame-index, value-index]
// of a given symbol x
const compile_time_environment_position = (env, x) => {
  let frame_index = env.length;
  while (value_index(env[--frame_index], x) === -1) {}
  return [frame_index, value_index(env[frame_index], x)];
};

const value_index = (frame, x) => {
  for (let i = 0; i < frame.length; i++) {
    if (frame[i] === x) return i;
  }
  return -1;
};

let is_context_switch = false;

// in this machine, the builtins take their
// arguments directly from the operand stack,
// to save the creation of an intermediate
// argument array
const builtin_implementation = {
  println: () => {
    const address = OS.pop();
    display(address_to_JS_value(address));
    OUTPUTS.push(String(address_to_JS_value(address)));
    return address;
  },
  sleep: () => {
    const time = OS.pop();
    blockingSleep(address_to_JS_value(time));
  },
  error: () => error(address_to_JS_value(OS.pop())),
  is_null: () => (is_Null(OS.pop()) ? True : False),
  Lock: () => {
    const frame_index = OS.pop();
    const value_index = OS.pop();
    const state = OS.pop();
    if (address_to_JS_value(state)) {
      // OS.pop();
      // OS_Q.push(OS);
      // PC_Q.push(PC - 4);
      // RTS_Q.push(RTS);
      // E_Q.push(E);
      const new_thread = new ThreadContext(E, PC - 4, OS, RTS);
      context_Q.push(new_thread);

      const thread = context_Q.shift();
      OS = thread.OS;
      PC = thread.PC;
      RTS = thread.RTS;
      E = thread.E;
      OS.push(1);
      is_context_switch = true;
      display("Mutex already locked");
      // display(address_to_JS_value(mutex_addr));
    } else {
      // heap_set(mutex_addr, 10);
      heap_set_Environment_value(
        E,
        [frame_index, value_index],
        JS_value_to_address(true)
      );
      display("Locking Mutex");
      // display(address_to_JS_value(mutex_addr));
    }
  },
  Unlock: () => {
    const frame_index = OS.pop();
    const value_index = OS.pop();
    const state = OS.pop();
    if (address_to_JS_value(state)) {
      heap_set_Environment_value(
        E,
        [frame_index, value_index],
        JS_value_to_address(false)
      );
      // display(address_to_JS_value(mutex_addr));
      display("Unlocking Mutex");
    } else {
      display("Mutex already unlocked");
      error("Mutex already unlocked");
    }
  },
};

const builtins = {};
const builtin_array = [];
{
  let i = 0;
  for (const key in builtin_implementation) {
    builtins[key] = {
      tag: "BUILTIN",
      id: i,
      arity: arity(builtin_implementation[key]),
    };
    builtin_array[i++] = builtin_implementation[key];
  }
}

const constants = {
  undefined: Undefined,
  math_E: math_E,
  math_LN10: math_LN10,
  math_LN2: math_LN2,
  math_LOG10E: math_LOG10E,
  math_LOG2E: math_LOG2E,
  math_PI: math_PI,
  math_SQRT1_2: math_SQRT1_2,
  math_SQRT2: math_SQRT2,
};

const compile_time_environment_extend = (vs, e) => {
  //  make shallow copy of e
  return push([...e], vs);
};

// compile-time frames only need synbols (keys), no values
const builtin_compile_frame = Object.keys(builtins);
const constant_compile_frame = Object.keys(constants);
const global_compile_environment = [
  builtin_compile_frame,
  constant_compile_frame,
];

// ********
// compiler
// ********

// scanning out the declarations from (possibly nested)
// sequences of statements, ignoring blocks
function scan_for_locals(statements) {
  //declare an empty array
  let locals = [];
  for (let statement of statements) {
    switch (statement.NodeType) {
      case "DeclStmt":
        locals.push(statement.Decl.Specs[0].Names[0].Name);
        break;
      case "GenDecl":
        locals.push(statement.Specs[0].Names[0].Name);
        break;
      case "FuncDecl":
        locals.push(statement.Name.Name);
        break;
    }
  }
  return locals;
}

const compile_sequence = (seq, ce) => {
  if (seq.length === 0) return (instrs[wc++] = { tag: "LDC", val: undefined });
  let first = true;
  for (let comp of seq) {
    first ? (first = false) : (instrs[wc++] = { tag: "POP" });
    compile(comp, ce);
  }
};

// wc: write counter
let wc;
// instrs: instruction array
let instrs;

const compile_comp = {
  BasicLit: (comp, ce) => {
    if (comp.Kind === "INT") {
      instrs[wc++] = { tag: "LDC", val: Number(comp.Value) };
    } else {
      instrs[wc++] = { tag: "LDC", val: comp.Value };
    }
  },
  Ident: (comp, ce) => {
    if (comp.Name === "true" || comp.Name === "false") {
      instrs[wc++] = { tag: "LDC", val: comp.Name === "true" };
    } else {
      instrs[wc++] = {
        tag: "LD",
        sym: comp.Name,
        pos: compile_time_environment_position(ce, comp.Name),
      };
    }
  },
  UnaryExpr: (comp, ce) => {
    if (comp.Op === "<-"){
      //attempt to access channel - ensure in scope
      compile({ NodeType: "Ident", Name: comp.X.Name}, ce)
      //POP OS @ RUNTIMe to remove chan value
      instrs[wc++] = { tag: "POP" }

      //TODO: push name of channel onto OS s.t. RECV can use it -> or maybe compile time pos?
      //TODO: Create RECV - see notepad impl
      
      instrs[wc++] = { tag: "RECV"};
      return
    }
    compile(comp.X, ce);
    instrs[wc++] = { tag: "UNOP", sym: comp.Op };
  },
  BinaryExpr: (comp, ce) => {
    compile(comp.X, ce);
    compile(comp.Y, ce);
    instrs[wc++] = { tag: "BINOP", sym: comp.Op };
  },
  IfStmt: (comp, ce) => {
    compile(comp.Cond, ce);
    const jump_on_false_instruction = { tag: "JOF" };
    instrs[wc++] = jump_on_false_instruction;
    compile(comp.Body, ce);
    const goto_instruction = { tag: "GOTO" };
    instrs[wc++] = goto_instruction;
    const alternative_address = wc;
    jump_on_false_instruction.addr = alternative_address;
    if (comp.Else !== null) {
      compile(comp.Else, ce);
    }
    goto_instruction.addr = wc;
  },
  ForStmt: (comp, ce) => {
    const loop_start = wc;
    compile(comp.Cond, ce);
    const jump_on_false_instruction = { tag: "JOF" };
    instrs[wc++] = jump_on_false_instruction;
    compile(comp.Body, ce);
    instrs[wc++] = { tag: "POP" };
    instrs[wc++] = { tag: "GOTO", addr: loop_start };
    jump_on_false_instruction.addr = wc;
    instrs[wc++] = { tag: "LDC", val: undefined };
  },
  CallExpr: (comp, ce) => {
    compile(comp.Fun, ce);
    if (comp.Args !== null) {
      for (let arg of comp.Args) {
        compile(arg, ce);
      }
      instrs[wc++] = { tag: "CALL", arity: comp.Args.length };
    } else {
      if (comp.Fun.NodeType === "SelectorExpr") {
        instrs[wc++] = { tag: "CALL", arity: 3 };
      } else {
        instrs[wc++] = { tag: "CALL", arity: 0 };
      }
    }
  },
  ExprStmt: (comp, ce) => {
    compile(comp.X, ce);
  },
  ParenExpr: (comp, ce) => {
    compile(comp.X, ce);
  },
  SelectorExpr: (comp, ce) => {
    compile(comp.Sel, ce);
    compile(comp.X, ce);
    instrs[wc++] = {
      tag: "LDADDR",
      sym: comp.X.Name,
      pos: compile_time_environment_position(ce, comp.X.Name),
    };
  },
  GoStmt: (comp, ce) => {
    comp.Call.NodeType = "GoCallExpr";
    compile(comp.Call, ce);
    instrs[wc++] = { tag: "ENDGO" };
  },
  GoCallExpr: (comp, ce) => {
    compile(comp.Fun, ce);
    if (comp.Args !== null) {
      for (let arg of comp.Args) {
        compile(arg, ce);
      }
      instrs[wc++] = { tag: "GOCALL", arity: comp.Args.length };
    } else {
      instrs[wc++] = { tag: "GOCALL", arity: 0 };
    }
  },
  FuncProc: (comp, ce) => {
    let prms = [];
    let arity = comp.Params.List !== null ? comp.Params.List.length : 0;
    // jump over the body of the lambda expression
    const goto_instruction = { tag: "GOTO" };
    instrs[wc++] = { tag: "LDF", arity: arity, addr: wc + 1 };
    instrs[wc++] = goto_instruction;
    if (arity > 0) {
      for (let prm of comp.Params.List) {
        prms.push(prm.Names[0].Name);
      }
    }
    // extend compile-time environment
    compile(comp.Body, compile_time_environment_extend(prms, ce));
    instrs[wc++] = { tag: "LDC", val: undefined };
    instrs[wc++] = { tag: "RESET" };
    goto_instruction.addr = wc;
  },
  List: (comp, ce) => compile_sequence(comp, ce),
  BlockStmt: (comp, ce) => {
    const locals = scan_for_locals(comp.List);
    instrs[wc++] = { tag: "ENTER_SCOPE", num: locals.length };
    compile(
      comp.List,
      // extend compile-time environment
      compile_time_environment_extend(locals, ce)
    );
    instrs[wc++] = { tag: "EXIT_SCOPE" };
  },
  DeclStmt: (comp, ce) => {
    if (comp.Decl.Specs[0].Values !== null) {
      compile(comp.Decl.Specs[0].Values[0], ce);
      instrs[wc++] = {
        tag: "ASSIGN",
        pos: compile_time_environment_position(
          ce,
          comp.Decl.Specs[0].Names[0].Name
        ),
      };
    } else if (comp.Decl.Specs[0].Type.NodeType === "SelectorExpr") {
      if (comp.Decl.Specs[0].Type.Sel.Name === "Mutex") {
        compile(
          {
            NodeType: "AssignStmt",
            Lhs: [comp.Decl.Specs[0].Names[0]],
            Tok: "=",
            Rhs: [
              {
                NodeType: "Ident",
                Name: "false",
              },
            ],
          },
          ce
        );
      }
    }
  },
  SendStmt: (comp, ce) => {
    //attempt to access channel - ensures in scope
    compile(comp.Value, ce);
    instrs[wc++] = {
      tag: "ASSIGN",
      pos: compile_time_environment_position(ce, comp.Chan.Name),
    };
    // POP OS @ RUNTIMe to remove chan value
    instrs[wc++] = { tag: "POP" }
    
    //NO NEED THIS: TODO: put channel name on os again for send to actually occur -> or maybe compile time pos?
    //TODO: Create SEND - see notepad impl
    
    instrs[wc++] = { tag: "SEND"};
  },
  GenDecl: (comp, ce) => {
    if (comp.Specs[0].Values[0].NodeType === "CallExpr" && 
    comp.Specs[0].Values[0].Fun.Name === "make" && 
    comp.Specs[0].Values[0].Fun.Args[0].NodeType === "ChanType"){
      compile(
        {
          NodeType: "AssignStmt",
          Lhs: [comp.Specs[0].Names[0]],
          Tok: "=",
          Rhs: [
            {
              NodeType: "Ident",
              Name: "false", //some dummy value
            },
          ],
        },
        ce
      );
      //TODO: NEED TO POP THE OS AT RUNTIME TO GET RID OF CHAN VALUE ??

    }
    else if (comp.Specs[0].Values !== null) {
      compile(comp.Specs[0].Values[0], ce);
      instrs[wc++] = {
        tag: "ASSIGN",
        pos: compile_time_environment_position(ce, comp.Specs[0].Names[0].Name),
      };
    } else if (comp.Specs[0].Type.NodeType === "SelectorExpr") {
      if (comp.Specs[0].Type.Sel.Name === "Mutex") {
        compile(
          {
            NodeType: "AssignStmt",
            Lhs: [comp.Specs[0].Names[0]],
            Tok: "=",
            Rhs: [
              {
                NodeType: "Ident",
                Name: "false",
              },
            ],
          },
          ce
        );
      }
    }
  },
  AssignStmt: (comp, ce) => {
    compile(comp.Rhs[0], ce);
    instrs[wc++] = {
      tag: "ASSIGN",
      pos: compile_time_environment_position(ce, comp.Lhs[0].Name),
    };
  },
  ReturnStmt: (comp, ce) => {
    compile(comp.Results[0], ce);
    instrs[wc++] = { tag: "RESET" };
  },
  FuncDecl: (comp, ce) => {
    compile(
      {
        NodeType: "AssignStmt",
        Lhs: [comp.Name],
        Rhs: [
          {
            NodeType: "FuncProc",
            Params: comp.Type.Params,
            Body: comp.Body,
            Name: comp.Name.Name,
          },
        ],
      },
      ce
    );
  },
};

// compile component into instruction array instrs,
// starting at wc (write counter)
const compile = (comp, ce) => {
  if (Array.isArray(comp)) {
    compile_comp["List"](comp, ce);
  } else {
    compile_comp[comp.NodeType](comp, ce);
  }
};

// compile program into instruction array instrs,
// after initializing wc and instrs
const compile_program = (program) => {
  wc = 0;
  instrs = [];
  compile(program, global_compile_environment);
  instrs[wc] = { tag: "DONE" };
};

// **********************
// operators and builtins
// **********************/
// os: [0, 100]
const binop_microcode = {
  "+": (x, y) =>
    (is_number(x) && is_number(y)) || (is_string(x) && is_string(y))
      ? x + y
      : error([x, y], "+ expects two numbers" + " or two strings, got:"),
  // todo: add error handling to JS for the following, too
  "*": (x, y) => x * y,
  "-": (x, y) => x - y,
  "/": (x, y) => x / y,
  "%": (x, y) => x % y,
  "<": (x, y) => x < y,
  "<=": (x, y) => x <= y,
  ">=": (x, y) => x >= y,
  ">": (x, y) => x > y,
  "==": (x, y) => x === y,
  "!=": (x, y) => x !== y,
  "&&": (x, y) => x && y,
  "||": (x, y) => x || y,
};

// v2 is popped before v1
const apply_binop = (op, v2, v1) =>
  JS_value_to_address(
    binop_microcode[op](address_to_JS_value(v1), address_to_JS_value(v2))
  );

const unop_microcode = {
  "-": (x) => -x,
  "!": (x) => !x,
};

const apply_unop = (op, v) =>
  JS_value_to_address(unop_microcode[op](address_to_JS_value(v)));

const apply_builtin = (builtin_id) => {
  const result = builtin_array[builtin_id]();
  OS.pop(); // pop fun
  if (!is_context_switch) {
    push(OS, result);
  } else {
    is_context_switch = false;
  }
};

const allocate_builtin_frame = () => {
  const builtin_values = Object.values(builtins);
  const frame_address = heap_allocate_Frame(builtin_values.length);
  for (let i = 0; i < builtin_values.length; i++) {
    const builtin = builtin_values[i];
    heap_set_child(frame_address, i, heap_allocate_Builtin(builtin.id));
  }
  return frame_address;
};

const allocate_constant_frame = () => {
  const constant_values = Object.values(constants);
  const frame_address = heap_allocate_Frame(constant_values.length);
  for (let i = 0; i < constant_values.length; i++) {
    const constant_value = constant_values[i];
    if (typeof constant_value === "undefined") {
      heap_set_child(frame_address, i, Undefined);
    } else {
      heap_set_child(frame_address, i, heap_allocate_Number(constant_value));
    }
  }
  return frame_address;
};

// *******
// machine
// *******

// machine registers
let OS; // JS array (stack) of words (Addresses,
//        word-encoded literals, numbers)
let PC; // JS number
let E; // heap Address
let RTS; // JS array (stack) of Addresses

let OS_Q;
let PC_Q;
let RTS_Q;
let E_Q;

HEAP; // (declared above already)

const microcode = {
  LDC: (instr) => push(OS, JS_value_to_address(instr.val)),
  UNOP: (instr) => push(OS, apply_unop(instr.sym, OS.pop())),
  BINOP: (instr) => push(OS, apply_binop(instr.sym, OS.pop(), OS.pop())),
  POP: (instr) => OS.pop(),
  JOF: (instr) => (PC = is_True(OS.pop()) ? PC : instr.addr),
  GOTO: (instr) => (PC = instr.addr),
  ENTER_SCOPE: (instr) => {
    push(RTS, heap_allocate_Blockframe(E));
    const frame_address = heap_allocate_Frame(instr.num);
    E = heap_Environment_extend(frame_address, E);
    for (let i = 0; i < instr.num; i++) {
      heap_set_child(frame_address, i, Unassigned);
    }
  },
  EXIT_SCOPE: (instr) => (E = heap_get_Blockframe_environment(RTS.pop())),
  LDADDR: (instr) => {
    const [frame_index, value_index] = instr.pos;
    push(OS, value_index);
    push(OS, frame_index);
  },
  LD: (instr) => {
    const val = heap_get_Environment_value(E, instr.pos);
    // console.log(address_to_JS_value(val) + " " + instr.pos);
    if (is_Unassigned(val)) error("access of unassigned variable");
    push(OS, val);
  },
  ASSIGN: (instr) => heap_set_Environment_value(E, instr.pos, peek(OS, 0)),
  LDF: (instr) => {
    const closure_address = heap_allocate_Closure(instr.arity, instr.addr, E);
    push(OS, closure_address);
  },
  ENDGO: (instr) => {
    if (context_Q.length != 0) {
      const thread = context_Q.shift();
      OS = thread.OS;
      PC = thread.PC;
      RTS = thread.RTS;
      E = thread.E;
    }
  },
  SEND: (instr) => {
    // save the value in the current thread's reg 
    // block and context switch
  },
  RECV: (instr) => {
    // 1. check context_q if there is exisitng sender alr there (iterate from start of context_q)
    // 2. if not, block itself i.e. just push itself to context q, ensure PC is at same instr s.t. check for corresponging send next time
    // 3. if yes, take value from sender, put in own OS
    //   4. unblock the sender by incrementing its PC
    // 5. unblock itself -> dont need to do anything 
    
  },
  GOCALL: (instr) => {
    const arity = instr.arity;
    const fun = peek(OS, arity);
    const new_PC = heap_get_Closure_pc(fun);
    const new_frame = heap_allocate_Frame(arity);
    for (let i = arity - 1; i >= 0; i--) {
      heap_set_child(new_frame, i, OS.pop());
    }
    OS.pop(); // pop fun

    // let new_thread_OS = [];
    // OS_Q.push(new_thread_OS);
    // let new_thread_RTS = [];
    push([], heap_allocate_Callframe(E, PC));
    // RTS_Q.push(new_thread_RTS);

    new_E = heap_Environment_extend(
      new_frame,
      heap_get_Closure_environment(fun)
    );
    // E_Q.push(new_E);
    // PC_Q.push(new_PC);
    const new_thread = new ThreadContext(new_E, new_PC);
    context_Q.push(new_thread);
    PC += 1;
  },
  CALL: (instr) => {
    const arity = instr.arity;
    const fun = peek(OS, arity);
    if (is_Builtin(fun)) {
      return apply_builtin(heap_get_Builtin_id(fun));
    }
    const new_PC = heap_get_Closure_pc(fun);
    const new_frame = heap_allocate_Frame(arity);
    for (let i = arity - 1; i >= 0; i--) {
      heap_set_child(new_frame, i, OS.pop());
    }
    push(RTS, heap_allocate_Callframe(E, PC));
    OS.pop(); // pop fun
    E = heap_Environment_extend(new_frame, heap_get_Closure_environment(fun));
    PC = new_PC;
  },
  TAIL_CALL: (instr) => {
    const arity = instr.arity;
    const fun = peek(OS, arity);
    if (is_Builtin(fun)) {
      return apply_builtin(heap_get_Builtin_id(fun));
    }
    const new_PC = heap_get_Closure_pc(fun);
    const new_frame = heap_allocate_Frame(arity);
    for (let i = arity - 1; i >= 0; i--) {
      heap_set_child(new_frame, i, OS.pop());
    }
    OS.pop(); // pop fun
    // don't push on RTS here
    E = heap_Environment_extend(new_frame, heap_get_Closure_environment(fun));
    PC = new_PC;
  },
  RESET: (instr) => {
    // keep popping...
    let top_frame = 0;
    if (RTS.length === 0) {
      const thread = context_Q.shift();
      OS = thread.OS;
      PC = thread.PC;
      RTS = thread.RTS;
      E = thread.E;
    } else {
      while (!is_Callframe(top_frame)) {
        top_frame = RTS.pop();
      }
      display(top_frame, "top frame: ");
      E = heap_get_Callframe_environment(top_frame);
      PC = heap_get_Callframe_pc(top_frame);
    }
  },
};

// initialise class
class ThreadContext {
  constructor(E, PC, OS, RTS) {
    if (arguments.length === 1) {
      this.OS = [];
      this.PC = 0;
      this.RTS = [];
      this.E = E;
    } else if (arguments.length === 2) {
      this.OS = [];
      this.PC = PC;
      this.RTS = [];
      this.E = E;
    } else {
      this.OS = OS;
      this.PC = PC;
      this.RTS = RTS;
      this.E = E;
    }
  }
}

// running the machine

let context_Q = [];
// set up registers, including free list
function initialize_machine(heapsize_words) {
  // OS_Q = [];
  // PC_Q = [];
  // RTS_Q = [];
  // E_Q = [];

  OS = [];
  PC = 0;
  RTS = [];

  // modified
  ALLOCATING = [];
  HEAP_BOTTOM = undefined; // the initial bottom is unknown

  HEAP = heap_make(heapsize_words);
  heap_size = heapsize_words;
  // initialize free list:
  // every free node carries the address
  // of the next free node as its first word
  let i = 0;
  for (i = 0; i <= heapsize_words - node_size; i = i + node_size) {
    heap_set(i, i + node_size);
  }
  // the empty free list is represented by -1
  heap_set(i - node_size, -1);
  free = 0;
  // PC = 0;
  allocate_literal_values();
  // display(free)
  const builtins_frame = allocate_builtin_frame();
  // display(free)
  const constants_frame = allocate_constant_frame();
  // display(free)
  E = heap_allocate_Environment(0);
  // display(free)
  E = heap_Environment_extend(builtins_frame, E);
  // display(free)
  E = heap_Environment_extend(constants_frame, E);
  // display(free)
  // modified

  const main_thread = new ThreadContext(E);
  context_Q.push(main_thread);
  // OS_Q.push(OS);
  // PC_Q.push(PC);
  // RTS_Q.push(RTS);
  // E_Q.push(E);

  HEAP_BOTTOM = free;
}

function run(heapsize_words) {
  initialize_machine(heapsize_words);

  let switch_freq = 10; //context switch every x instrs
  let i = 0;
  while (instrs[PC].tag !== "DONE") {
    if (i % switch_freq == 0) {
      let curr_thread = context_Q.shift();
      OS = curr_thread.OS;
      PC = curr_thread.PC;
      RTS = curr_thread.RTS;
      E = curr_thread.E;
      // OS = OS_Q.shift();
      // PC = PC_Q.shift();
      // RTS = RTS_Q.shift();
      // E = E_Q.shift();
    }

    i += 1;

    const instr = instrs[PC++];
    microcode[instr.tag](instr);

    if (instr != "ENDGO" && i % switch_freq == 0) {
      const thread = new ThreadContext(E, PC, OS, RTS);
      context_Q.push(thread);
      // OS_Q.push(OS);
      // PC_Q.push(PC);
      // RTS_Q.push(RTS);
      // E_Q.push(E);
    }
  }
  // return address_to_JS_value(peek(OS, 0));
}

const test = (program, expected, heapsize) => {
  display(
    "",
    `

****************
Test case: ` +
      program +
      "\n"
  );
  const result = parse_compile_run(program, heapsize);
  if (stringify(result) === stringify(expected)) {
    display(result, "success with result:");
  } else {
    display(expected, "FAILURE! expected:");
    error(result, "result:");
  }
};

// obj = {
//   NodeType: "File",
//   Doc: null,
//   Package: null,
//   Name: { NodeType: "Ident", Name: "main" },
//   Decls: [
//     {
//       NodeType: "GenDecl",
//       Tok: "var",
//       Specs: [
//         {
//           NodeType: "ValueSpec",
//           Names: [{ NodeType: "Ident", Name: "x" }],
//           Type: { NodeType: "Ident", Name: "int" },
//           Values: [{ NodeType: "BasicLit", Kind: "INT", Value: "2" }],
//         },
//       ],
//     },
//     {
//       NodeType: "FuncDecl",
//       Recv: null,
//       Name: { NodeType: "Ident", Name: "g" },
//       Type: {
//         NodeType: "FuncType",
//         TypeParams: null,
//         Params: { NodeType: "FieldList", List: null },
//         Results: null,
//       },
//       Body: {
//         NodeType: "BlockStmt",
//         List: [
//           {
//             NodeType: "DeclStmt",
//             Decl: {
//               NodeType: "GenDecl",
//               Tok: "var",
//               Specs: [
//                 {
//                   NodeType: "ValueSpec",
//                   Names: [{ NodeType: "Ident", Name: "i" }],
//                   Type: { NodeType: "Ident", Name: "int" },
//                   Values: [{ NodeType: "BasicLit", Kind: "INT", Value: "0" }],
//                 },
//               ],
//             },
//           },
//           {
//             NodeType: "ForStmt",
//             Init: null,
//             Cond: {
//               NodeType: "BinaryExpr",
//               X: { NodeType: "Ident", Name: "i" },
//               Op: "\u003c",
//               Y: { NodeType: "BasicLit", Kind: "INT", Value: "3" },
//             },
//             Post: null,
//             Body: {
//               NodeType: "BlockStmt",
//               List: [
//                 {
//                   NodeType: "AssignStmt",
//                   Lhs: [{ NodeType: "Ident", Name: "x" }],
//                   Tok: "=",
//                   Rhs: [{ NodeType: "BasicLit", Kind: "INT", Value: "1" }],
//                 },
//                 {
//                   NodeType: "ExprStmt",
//                   X: {
//                     NodeType: "CallExpr",
//                     Fun: { NodeType: "Ident", Name: "println" },
//                     Args: [{ NodeType: "Ident", Name: "x" }],
//                   },
//                 },
//                 {
//                   NodeType: "AssignStmt",
//                   Lhs: [{ NodeType: "Ident", Name: "i" }],
//                   Tok: "=",
//                   Rhs: [
//                     {
//                       NodeType: "BinaryExpr",
//                       X: { NodeType: "Ident", Name: "i" },
//                       Op: "+",
//                       Y: {
//                         NodeType: "BasicLit",
//                         Kind: "INT",
//                         Value: "1",
//                       },
//                     },
//                   ],
//                 },
//               ],
//             },
//           },
//         ],
//       },
//     },
//     {
//       NodeType: "FuncDecl",
//       Recv: null,
//       Name: { NodeType: "Ident", Name: "main" },
//       Type: {
//         NodeType: "FuncType",
//         TypeParams: null,
//         Params: { NodeType: "FieldList", List: null },
//         Results: null,
//       },
//       Body: {
//         NodeType: "BlockStmt",
//         List: [
//           {
//             NodeType: "DeclStmt",
//             Decl: {
//               NodeType: "GenDecl",
//               Tok: "var",
//               Specs: [
//                 {
//                   NodeType: "ValueSpec",
//                   Names: [{ NodeType: "Ident", Name: "y" }],
//                   Type: { NodeType: "Ident", Name: "int" },
//                   Values: [{ NodeType: "BasicLit", Kind: "INT", Value: "0" }],
//                 },
//               ],
//             },
//           },
//           {
//             NodeType: "GoStmt",
//             Call: {
//               NodeType: "CallExpr",
//               Fun: { NodeType: "Ident", Name: "g" },
//               Args: null,
//             },
//           },
//           {
//             NodeType: "ForStmt",
//             Init: null,
//             Cond: {
//               NodeType: "BinaryExpr",
//               X: { NodeType: "Ident", Name: "y" },
//               Op: "\u003c",
//               Y: { NodeType: "BasicLit", Kind: "INT", Value: "100" },
//             },
//             Post: null,
//             Body: {
//               NodeType: "BlockStmt",
//               List: [
//                 {
//                   NodeType: "AssignStmt",
//                   Lhs: [{ NodeType: "Ident", Name: "y" }],
//                   Tok: "=",
//                   Rhs: [
//                     {
//                       NodeType: "BinaryExpr",
//                       X: { NodeType: "Ident", Name: "y" },
//                       Op: "+",
//                       Y: {
//                         NodeType: "BasicLit",
//                         Kind: "INT",
//                         Value: "1",
//                       },
//                     },
//                   ],
//                 },
//               ],
//             },
//           },
//           {
//             NodeType: "ExprStmt",
//             X: {
//               NodeType: "CallExpr",
//               Fun: { NodeType: "Ident", Name: "println" },
//               Args: [{ NodeType: "BasicLit", Kind: "INT", Value: "25" }],
//             },
//           },
//         ],
//       },
//     },
//   ],
//   Imports: null,
//   Unresolved: null,
//   Comments: null,
//   FileSet: {
//     Base: 225,
//     Files: [
//       {
//         Name: "./temp/src_code.go",
//         Base: 1,
//         Size: 223,
//         Lines: [
//           0, 13, 14, 28, 29, 40, 55, 68, 76, 95, 107, 110, 112, 113, 127, 142,
//           167, 168, 176, 191, 203, 206, 222,
//         ],
//         Infos: null,
//       },
//     ],
//   },
// };

function compile_and_run(obj) {
  let main_call = {
    NodeType: "CallExpr",
    Fun: { NodeType: "Ident", Name: "main" },
    Args: [],
  };
  obj.Decls.push(main_call);
  json_code = { NodeType: "BlockStmt", List: obj.Decls };
  // console.log(json_code);
  compile_program(json_code);
  run(50000);
  return OUTPUTS;
}

// compile_and_run(obj);

module.exports = compile_and_run;
