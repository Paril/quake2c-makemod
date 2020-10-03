// @ts-check
/*
 * Copyright (c) 2002 - 2020 Tony Finch <dot@dotat.at>
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR AND CONTRIBUTORS ``AS IS'' AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED.  IN NO EVENT SHALL THE AUTHOR OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS
 * OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
 * HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
 * LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY
 * OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
 * SUCH DAMAGE.
 */

/*
 * unifdef - remove ifdef'ed lines
 *
 * This code was derived from software contributed to Berkeley by Dave Yost.
 * It was rewritten to support ANSI C by Tony Finch. The original version
 * of unifdef carried the 4-clause BSD copyright licence. None of its code
 * remains in this version (though some of the names remain) so it now
 * carries a more liberal licence.
 *
 *  Wishlist:
 *      provide an option which will append the name of the
 *        appropriate symbol after #else's and #endif's
 *      provide an option which will check symbols after
 *        #else's and #endif's to see that they match their
 *        corresponding #ifdef or #ifndef
 *
 *   These require better buffer handling, which would also make
 *   it possible to handle all "dodgy" directives correctly.
 */

/** types of input lines:
 * @enum {number}
 */
const Linetype = {
	LT_TRUEI: 0,		/* a true #if with ignore flag */
	LT_FALSEI: 1,		/* a false #if with ignore flag */
	LT_IF: 2,			/* an unknown #if */
	LT_TRUE: 3,			/* a true #if */
	LT_FALSE: 4,		/* a false #if */
	LT_ELIF: 5,			/* an unknown #elif */
	LT_ELTRUE: 6,		/* a true #elif */
	LT_ELFALSE: 7,		/* a false #elif */
	LT_ELSE: 8,			/* #else */
	LT_ENDIF: 9,		/* #endif */
	LT_DODGY: 10,		/* flag: directive is not on one line */
	LT_DODGY_LAST: 10 + 9, // LT_DODGY + LT_ENDIF
	LT_PLAIN: 20,		/* ordinary line */
	LT_EOF: 21,			/* end of file */
	LT_ERROR: 22,		/* unevaluable #if */
	LT_COUNT: 23
};

const linetype_name = [
	"TRUEI", "FALSEI", "IF", "TRUE", "FALSE",
	"ELIF", "ELTRUE", "ELFALSE", "ELSE", "ENDIF",
	"DODGY TRUEI", "DODGY FALSEI",
	"DODGY IF", "DODGY TRUE", "DODGY FALSE",
	"DODGY ELIF", "DODGY ELTRUE", "DODGY ELFALSE",
	"DODGY ELSE", "DODGY ENDIF",
	"PLAIN", "EOF", "ERROR"
];

/** @param {Linetype} lt */
const linetype_if2elif = lt => lt - Linetype.LT_IF + Linetype.LT_ELIF;
/** @param {Linetype} lt */
const linetype_2dodgy = lt => lt + Linetype.LT_DODGY;

/** state of #if processing
 * @enum {number}
 */
const Ifstate = {
	IS_OUTSIDE: 0,
	IS_FALSE_PREFIX: 1,		/* false #if followed by false #elifs */
	IS_TRUE_PREFIX: 2,		/* first non-false #(el)if is true */
	IS_PASS_MIDDLE: 3,		/* first non-false #(el)if is unknown */
	IS_FALSE_MIDDLE: 4,		/* a false #elif after a pass state */
	IS_TRUE_MIDDLE: 5,		/* a true #elif after a pass state */
	IS_PASS_ELSE: 6,		/* an else after a pass state */
	IS_FALSE_ELSE: 7,		/* an else after a true state */
	IS_TRUE_ELSE: 8,		/* an else after only false states */
	IS_FALSE_TRAILER: 9,	/* #elifs after a true are false */
	IS_COUNT: 10
};

const ifstate_name = [
	"OUTSIDE", "FALSE_PREFIX", "TRUE_PREFIX",
	"PASS_MIDDLE", "FALSE_MIDDLE", "TRUE_MIDDLE",
	"PASS_ELSE", "FALSE_ELSE", "TRUE_ELSE",
	"FALSE_TRAILER"
];

/** state of comment parser
 * @enum {number}
 */
const Comment_state = {
	NO_COMMENT: 0,			/* outside a comment */
	C_COMMENT: 1,			/* in a comment like this one */
	CXX_COMMENT: 2,			/* between // and end of line */
	STARTING_COMMENT: 3,	/* just after slash-backslash-newline */
	FINISHING_COMMENT: 4,	/* star-backslash-newline in a C comment */
	CHAR_LITERAL: 5,		/* inside '' */
	STRING_LITERAL: 6,		/* inside "" */
	RAW_STRING_LITERAL: 7	/* inside R"()" */
};

const comment_name = [
	"NO", "C", "CXX", "STARTING", "FINISHING", "CHAR", "STRING"
];

/** state of preprocessor line parser
 * @enum {number}
 */
const Line_state = {
	LS_START: 0,	/* only space and comments on this line */
	LS_HASH: 1,		/* only space, comments, and a hash */
	LS_DIRTY: 2		/* this line can't be a preprocessor line */
};

const linestate_name = [
	"START", "HASH", "DIRTY"
];

const newline_unix = "\n";
const newline_crlf = "\r\n";

/** @typedef {{ name: string, value: string, ignored: boolean }} unifdefsymbol */

/** @typedef {{ compblank?: boolean, lnblank?: boolean, complement?: boolean, debugging?: boolean,
 * iocccok?: boolean, strictlogic?: boolean, killconsts?: boolean, lnnum?: boolean, symlist?: boolean,
 * symdepth?: boolean, text?: boolean, linefile?: string }} unifdefsettings */

/** @typedef {{ altered: boolean, output: string }} unifdefoutput */

/** @typedef {{ input: string, defundef?: string, symbols?: unifdefsymbol[] }} unifdefinput */

/** @typedef {{ state: Ifstate, ignored: boolean, stifline: number }} unidefifstate */

/** @typedef {{ str: string, fn: (p: number, at: Linetype, a: number, bt: Linetype, b: number) => [ Linetype, number ], stop?: string }} unifdefop */

/** @typedef {{ inner: (ops: unifdefops, valp: number, cpp: number) => [ Linetype, number, number ], op: unifdefop[] }} unifdefops */
	
const alnum = /\w/;
const spacenotnew = /[ \r\t]/;
const spaceornew = /[ \r\t\n]/;
const digit = /[1234567890]/

class unifdef_
{
	/**
	 * Add a symbol to the symbol table
	 * @param {boolean} ignorethis
	 * @param {string} sym
	 * @param {string} val
	 */
	addsym(ignorethis, sym, val)
	{
		let [ symind ] = this.findsym(sym, 0);

		if (symind === -1 || symind >= this.symbols.length)
		{
			symind = this.symbols.length;
			this.symbols.push({
				name: sym,
				value: val,
				ignored: ignorethis
			});
		}
		else
			this.symbols[symind] = {
				name: sym,
				value: val,
				ignored: ignorethis
			};

		this.debugsym("addsym", symind);
	}

	start()
	{
		if (this.settings.compblank && this.settings.lnblank)
			this.error("-B and -b are mutually exclusive");

		if (this.input.symbols)
			this.symbols.push(...this.input.symbols);
		if (this.input.defundef)
			this.defundefile();

		this.indirectsym();
		this.process();
	}

	// state
	/**
	 * @param {unifdefsettings} settings
	 * @param {unifdefinput} input
	 * @param {unifdefoutput} output
	 */
	constructor(settings, input, output)
	{
		this.settings = settings;
		this.input = input;
		this.output = output;

		/** @type {unifdefsymbol[]} */
		this.symbols = [];	/* symbol name */
							/* -Dsym=value */
							/* -iDsym or -iUsym */

		this.inputpos = 0;
		this.linenum = 0;		/* current line number */

		/** @type {string} */
		this.tline = "";		/* input buffer plus space */
		this.keyword_pos = 0;	/* used for editing #elif's */

	/*
	* When processing a file, the output's newline style will match the
	* input's, and unifdef correctly handles CRLF or LF endings whatever
	* the platform's native style. The stdio streams are opened in binary
	* mode to accommodate platforms whose native newline style is CRLF.
	* When the output isn't a processed input file (when it is error /
	* debug / diagnostic messages) then unifdef uses native line endings.
	*/

		/** @type {null|"\n"|"\r\n"} */
		this.newline = null;		/* input file format */

		/** @type {Comment_state} */
		this.incomment = Comment_state.NO_COMMENT;/* comment parser state */
		/** @type {Line_state} */
		this.linestate = Line_state.LS_START;	/* #if line parser state */
		// these states start with 1 because depth of 0 is valid entry
		/** @type {unidefifstate[]} */
		this.states = [];/* #if processor state */
						/* ignore comments state */
						/* start of current #if */
		this.states.push({
			state: Ifstate.IS_OUTSIDE,
			ignored: false,
			stifline: 0
		});
		this.delcount = 0;			/* count of deleted lines */
		this.blankcount = 0;		/* count of blank lines */
		this.blankmax = 0;			/* maximum recent blankcount */
		this.constexprs = false;	/* constant #if expression */
		this.zerosyms = false;		/* to format symdepth output */
		this.firstsym = false;		/* ditto */

		this.trans_table = [
			/* IS_OUTSIDE */
			[	this.Itrue, this.Ifalse,this.Fpass, this.Ftrue, this.Ffalse,this.Eelif, this.Eelif, this.Eelif, this.Eelse, this.Eendif,
				this.Oiffy, this.Oiffy, this.Fpass, this.Oif,   this.Oif,   this.Eelif, this.Eelif, this.Eelif, this.Eelse, this.Eendif,
				this.print, this.done,  this.abort ],
			/* IS_FALSE_PREFIX */
			[	this.Idrop, this.Idrop, this.Fdrop, this.Fdrop, this.Fdrop, this.Mpass, this.Strue, this.Sfalse,this.Selse, this.Dendif,
				this.Idrop, this.Idrop, this.Fdrop, this.Fdrop, this.Fdrop, this.Mpass, this.Eioccc,this.Eioccc,this.Eioccc,this.Eioccc,
				this.drop,  this.Eeof,  this.abort ],
			/* IS_TRUE_PREFIX */
			[	this.Itrue, this.Ifalse,this.Fpass, this.Ftrue, this.Ffalse,this.Dfalse,this.Dfalse,this.Dfalse,this.Delse, this.Dendif,
				this.Oiffy, this.Oiffy, this.Fpass, this.Oif,   this.Oif,   this.Eioccc,this.Eioccc,this.Eioccc,this.Eioccc,this.Eioccc,
				this.print, this.Eeof,  this.abort ],
			/* IS_PASS_MIDDLE */
			[	this.Itrue, this.Ifalse,this.Fpass, this.Ftrue, this.Ffalse,this.Pelif, this.Mtrue, this.Delif, this.Pelse, this.Pendif,
				this.Oiffy, this.Oiffy, this.Fpass, this.Oif,   this.Oif,   this.Pelif, this.Oelif, this.Oelif, this.Pelse, this.Pendif,
				this.print, this.Eeof,  this.abort ],
			/* IS_FALSE_MIDDLE */
			[	this.Idrop, this.Idrop, this.Fdrop, this.Fdrop, this.Fdrop, this.Pelif, this.Mtrue, this.Delif, this.Pelse, this.Pendif,
				this.Idrop, this.Idrop, this.Fdrop, this.Fdrop, this.Fdrop, this.Eioccc,this.Eioccc,this.Eioccc,this.Eioccc,this.Eioccc,
				this.drop,  this.Eeof,  this.abort ],
			/* IS_TRUE_MIDDLE */
			[	this.Itrue, this.Ifalse,this.Fpass, this.Ftrue, this.Ffalse,this.Melif, this.Melif, this.Melif, this.Melse, this.Pendif,
				this.Oiffy, this.Oiffy, this.Fpass, this.Oif,   this.Oif,   this.Eioccc,this.Eioccc,this.Eioccc,this.Eioccc,this.Pendif,
				this.print, this.Eeof,  this.abort ],
			/* IS_PASS_ELSE */
			[	this.Itrue, this.Ifalse,this.Fpass, this.Ftrue, this.Ffalse,this.Eelif, this.Eelif, this.Eelif, this.Eelse, this.Pendif,
				this.Oiffy, this.Oiffy, this.Fpass, this.Oif,   this.Oif,   this.Eelif, this.Eelif, this.Eelif, this.Eelse, this.Pendif,
				this.print, this.Eeof,  this.abort ],
			/* IS_FALSE_ELSE */
			[	this.Idrop, this.Idrop, this.Fdrop, this.Fdrop, this.Fdrop, this.Eelif, this.Eelif, this.Eelif, this.Eelse, this.Dendif,
				this.Idrop, this.Idrop, this.Fdrop, this.Fdrop, this.Fdrop, this.Eelif, this.Eelif, this.Eelif, this.Eelse, this.Eioccc,
				this.drop,  this.Eeof,  this.abort ],
			/* IS_TRUE_ELSE */
			[	this.Itrue, this.Ifalse,this.Fpass, this.Ftrue, this.Ffalse,this.Eelif, this.Eelif, this.Eelif, this.Eelse, this.Dendif,
				this.Oiffy, this.Oiffy, this.Fpass, this.Oif,   this.Oif,   this.Eelif, this.Eelif, this.Eelif, this.Eelse, this.Eioccc,
				this.print, this.Eeof,  this.abort ],
			/* IS_FALSE_TRAILER */
			[	this.Idrop, this.Idrop, this.Fdrop, this.Fdrop, this.Fdrop, this.Dfalse,this.Dfalse,this.Dfalse,this.Delse, this.Dendif,
				this.Idrop, this.Idrop, this.Fdrop, this.Fdrop, this.Fdrop, this.Dfalse,this.Dfalse,this.Dfalse,this.Delse, this.Eioccc,
				this.drop,  this.Eeof,  this.abort ]
			/*TRUEI  FALSEI IF     TRUE   FALSE  ELIF   ELTRUE ELFALSE ELSE  ENDIF
			  TRUEI  FALSEI IF     TRUE   FALSE  ELIF   ELTRUE ELFALSE ELSE  ENDIF (DODGY)
			  PLAIN  EOF    ERROR */
		];

	/*struct op
	{
		using op_fn = std::tuple<Linetype, int>(unifdef &, int, Linetype, int, Linetype, int);
		const char *str;
		op_fn *fn;
		const std::string stop = "";
	};*/
	/*struct ops
	{
		using eval_fn = std::tuple<Linetype, int, size_t>(unifdef &, const ops *, int, size_t);
		eval_fn *inner;
		op op[5];
	};*/

		/** @type {unifdefops[]} */
		this.eval_ops = [
			{ inner: this.eval_table, op: [ { str: "||", fn: this.op_or } ] },
			{ inner: this.eval_table, op: [ { str: "&&", fn: this.op_and } ] },
			{ inner: this.eval_table, op: [ { str: "|",  fn: this.op_bor, stop: "|" } ] },
			{ inner: this.eval_table, op: [ { str: "^",  fn: this.op_bxor } ] },
			{ inner: this.eval_table, op: [ { str: "&",  fn: this.op_band, stop: "&" } ] },
			{ inner: this.eval_table, op: [ { str: "==", fn: this.op_eq }, { str: "!=", fn: this.op_ne } ] },
			{ inner: this.eval_table, op: [ { str: "<=", fn: this.op_le }, { str: ">=", fn: this.op_ge }, { str: "<",  fn: this.op_lt, stop: "<=" }, { str: ">",  fn: this.op_gt, stop: ">=" } ] },
			{ inner: this.eval_table, op: [ { str: "<<", fn: this.op_blsh }, { str: ">>", fn: this.op_brsh } ] },
			{ inner: this.eval_table, op: [ { str: "+",  fn: this.op_add }, { str: "-",  fn: this.op_sub } ] },
			{ inner: this.eval_unary, op: [ { str: "*",  fn: this.op_mul }, { str: "/",  fn: this.op_div }, { str: "%",  fn: this.op_mod } ] },
		];
	}

	/** @param {string} c */
	endsym(c)
	{
		return c === undefined || !alnum.test(c);
	}

	/** @param {string} c */
	isspacenotnew(c)
	{
		return spacenotnew.test(c);
	}

	/** @param {string} c */
	isspaceornew(c)
	{
		return spaceornew.test(c);
	}

	/*
	 * A state transition function alters the global #if processing state
	 * in a particular way. The table below is indexed by the current
	 * processing state and the type of the current line.
	 *
	 * Nesting is handled by keeping a stack of states; some transition
	 * functions increase or decrease the depth. They also maintain the
	 * ignore state on a stack. In some complicated cases they have to
	 * alter the preprocessor directive, as follows.
	 *
	 * When we have processed a group that starts off with a known-false
	 * #if/#elif sequence (which has therefore been deleted) followed by a
	 * #elif that we don't understand and therefore must keep, we edit the
	 * latter into a #if to keep the nesting correct. We use memcpy() to
	 * overwrite the 4 byte token "elif" with "if  " without a '\0' byte.
	 *
	 * When we find a true #elif in a group, the following block will
	 * always be kept and the rest of the sequence after the next #elif or
	 * #else will be discarded. We edit the #elif into a #else and the
	 * following directive to #endif since this has the desired behaviour.
	 *
	 * "Dodgy" directives are split across multiple lines, the most common
	 * example being a multi-line comment hanging off the right of the
	 * directive. We can handle them correctly only if there is no change
	 * from printing to dropping (or vice versa) caused by that directive.
	 * If the directive is the first of a group we have a choice between
	 * failing with an error, or passing it through unchanged instead of
	 * evaluating it. The latter is not the default to avoid questions from
	 * users about unifdef unexpectedly leaving behind preprocessor directives.
	 */
	//using state_fn = void(unifdef&);

	/* report an error */
	Eelif () { this.error("Inappropriate #elif"); }
	Eelse () { this.error("Inappropriate #else"); }
	Eendif() { this.error("Inappropriate #endif"); }
	Eeof  () { this.error("Premature EOF"); }
	Eioccc() { this.error("Obfuscated preprocessor control line"); }
	/* plain line handling */
	print () { this.flushline(true); }
	drop  () { this.flushline(false); }
	/* output lacks group's start line */
	Strue () { this.drop();  this.ignoreoff(); this.state(Ifstate.IS_TRUE_PREFIX); }
	Sfalse() { this.drop();  this.ignoreoff(); this.state(Ifstate.IS_FALSE_PREFIX); }
	Selse () { this.drop();               this.state(Ifstate.IS_TRUE_ELSE); }
	/* print/pass this block */
	Pelif () { this.print(); this.ignoreoff(); this.state(Ifstate.IS_PASS_MIDDLE); }
	Pelse () { this.print();              this.state(Ifstate.IS_PASS_ELSE); }
	Pendif() { this.print(); this.unnest(); }
	/* discard this block */
	Dfalse() { this.drop();  this.ignoreoff(); this.state(Ifstate.IS_FALSE_TRAILER); }
	Delif () { this.drop();  this.ignoreoff(); this.state(Ifstate.IS_FALSE_MIDDLE); }
	Delse () { this.drop();               this.state(Ifstate.IS_FALSE_ELSE); }
	Dendif() { this.drop();  this.unnest(); }
	/* first line of group */
	Fdrop () { this.nest();  this.Dfalse(); }
	Fpass () { this.nest();  this.Pelif(); }
	Ftrue () { this.nest();  this.Strue(); }
	Ffalse() { this.nest();  this.Sfalse(); }
	/* variable pedantry for obfuscated lines */
	Oiffy () { if (!this.settings.iocccok) this.Eioccc(); this.Fpass(); this.ignoreon(); }
	Oif   () { if (!this.settings.iocccok) this.Eioccc(); this.Fpass(); }
	Oelif () { if (!this.settings.iocccok) this.Eioccc(); this.Pelif(); }
	/* ignore comments in this block */
	Idrop () { this.Fdrop();  this.ignoreon(); }
	Itrue () { this.Ftrue();  this.ignoreon(); }
	Ifalse() { this.Ffalse(); this.ignoreon(); }
	/* modify this line */
	Mpass () { this.tline = this.tline.substr(0, this.keyword_pos) + "if  " + this.tline.substr(this.keyword_pos + 4); this.Pelif(); }
	Mtrue () { this.keywordedit("else");  this.state(Ifstate.IS_TRUE_MIDDLE); }
	Melif () { this.keywordedit("endif"); this.state(Ifstate.IS_FALSE_TRAILER); }
	Melse () { this.keywordedit("endif"); this.state(Ifstate.IS_FALSE_ELSE); }

	/*
	 * The last state transition function. When this is called,
	 * lineval == LT_EOF, so the process() loop will terminate.
	 */
	done()
	{
		if (this.incomment)
			this.error("EOF in comment");
		this.closeio();
	}

	abort()
	{
		throw new Error();
	}

	/*
	 * State machine utility functions
	 */
	ignoreoff()
	{
		if (!this.states.length)
			this.abort(); /* bug */
		this.states[this.states.length - 1].ignored = this.states[this.states.length - 2].ignored;
	}

	ignoreon()
	{
		this.states[this.states.length - 1].ignored = true;
	}

	/** @param {string} replacement */
	keywordedit(replacement)
	{
		this.tline = this.tline.substr(0, this.keyword_pos);
		this.tline += replacement;
		this.tline += this.newline;
		this.output.altered = true;
		this.print();
	}

	nest()
	{
		this.states.push({
			state: Ifstate.IS_OUTSIDE,
			ignored: false,
			stifline: this.linenum
		});
	}

	unnest()
	{
		if (!this.states.length)
			this.abort(); /* bug */
		this.states.pop();
	}

	/** @param {Ifstate} is */
	state(is)
	{
		this.states[this.states.length - 1].state = is;
	}

	/**
	 * Write a line to the output or not, according to command line options.
	 * If writing fails, closeio() will print the error and exit.
	 * @param {boolean} keep
	 */
	flushline(keep)
	{
		if (this.settings.symlist)
			return;

		if (keep ^ this.settings.complement)
		{
			const blankline = this.tline.search(spaceornew) === -1;
			if (blankline && this.settings.compblank && this.blankcount != this.blankmax)
			{
				this.delcount += 1;
				this.blankcount += 1;
			}
			else
			{
				if (this.settings.lnnum && this.delcount > 0)
					this.hashline();
				this.output.output += this.tline;
				this.delcount = 0;
				this.blankmax = this.blankcount = (blankline ? this.blankcount + 1 : 0);
			}
		}
		else
		{
			if (this.settings.lnblank)
				this.output.output += this.newline;
			this.output.altered = true;
			this.delcount += 1;
			this.blankcount = 0;
		}
	}

	/*
	 * Format of #line directives depends on whether we know the input filename.
	 */
	hashline()
	{
		if (!this.settings.linefile || !this.settings.linefile.length)
			this.output.output += "#line " + this.linenum + this.newline;
		else
			this.output.output += "#line " + this.linenum + " \"" + this.settings.linefile + "\"" + this.newline;
	}

	/*
	 * Flush the output and handle errors.
	 */
	closeio()
	{
		/* Tidy up after findsym(). */
		if (this.settings.symdepth && !this.zerosyms)
			this.output.output += "\n";
	}

	/*
	 * The driver for the state machine.
	 */
	process()
	{
		/** @type {Linetype} */
		let lineval = Linetype.LT_PLAIN;
		/* When compressing blank lines, act as if the file
		   is preceded by a large number of blank lines. */
		this.blankmax = this.blankcount = Number.MAX_SAFE_INTEGER;
		this.zerosyms = true;
		this.newline = null;
		this.linenum = 0;
		this.output.altered = false;
		while (lineval !== Linetype.LT_EOF)
		{
			lineval = this.parseline();
			this.trans_table[this.states[this.states.length - 1].state][lineval].call(this);
			this.debug("process line " + this.linenum + " " + linetype_name[lineval] + " -> " + ifstate_name[this.states[this.states.length - 1].state] + " depth " + this.states.length);
		}
	}

	/**
	 * Parse a line and determine its type. We keep the preprocessor line
	 * parser state between calls in the global variable linestate, with
	 * help from skipcomment().
	 */
	parseline()
	{
		/** @type {Linetype} */
		let retval;

		const wascomment = this.incomment;
		let cp = this.skiphash(this.input.input);

		const done = () =>
		{
			this.debug("parser line " + this.linenum + " state " + comment_name[this.incomment] + " comment " + linestate_name[this.linestate] + " line");
			return retval;
		};

		if (cp === -1)
			return Linetype.LT_EOF;
		if (this.newline == null)
		{
			if (this.tline.lastIndexOf('\n') === this.tline.lastIndexOf('\r') + 1)
				this.newline = newline_crlf;
			else
				this.newline = newline_unix;
		}
		if (cp == this.tline.length)
		{
			retval = Linetype.LT_PLAIN;
			return done();
		}
		this.keyword_pos = cp;
		if ((cp = this.matchsym("ifdef", this.tline, this.keyword_pos)) !== -1 ||
			(cp = this.matchsym("ifndef", this.tline, this.keyword_pos)) !== -1)
		{
			cp = this.skipcomment(cp);
			const [ cursym, _cp ] = this.findsym(this.tline, cp);
			cp = _cp;
			if (cursym == -1)
				retval = Linetype.LT_IF;
			else
			{
				retval = (this.tline[this.keyword_pos + 2] == 'n') ? Linetype.LT_FALSE : Linetype.LT_TRUE;
				if (this.symbols[cursym].value === null)
					retval = (retval == Linetype.LT_TRUE) ? Linetype.LT_FALSE : Linetype.LT_TRUE;
				if (this.symbols[cursym].ignored)
					retval = (retval == Linetype.LT_TRUE) ? Linetype.LT_TRUEI : Linetype.LT_FALSEI;
			}
		}
		else if ((cp = this.matchsym("if", this.tline, this.keyword_pos)) != -1)
		{
			const [ _retval, _cp ] = this.ifeval(cp);
			retval = _retval;
			cp = _cp;
		}
		else if ((cp = this.matchsym("elif", this.tline, this.keyword_pos)) != -1)
		{
			const [ _retval, _cp ] = this.ifeval(cp);
			retval = linetype_if2elif(_retval);
			cp = _cp;
		}
		else if ((cp = this.matchsym("else", this.tline, this.keyword_pos)) != -1)
			retval = Linetype.LT_ELSE;
		else if ((cp = this.matchsym("endif", this.tline, this.keyword_pos)) != -1)
			retval = Linetype.LT_ENDIF;
		else
		{
			cp = this.skipsym(this.tline, this.keyword_pos);
			/* no way can we deal with a continuation inside a keyword */
			if (this.tline.substr(cp, 3) == "\\\r\n" ||
				this.tline.substr(cp, 2) == "\\\n")
				this.Eioccc();
			cp = this.skipline(cp);
			retval = Linetype.LT_PLAIN;
			return done();
		}
		cp = this.skipcomment(cp);
		if (cp != this.tline.length)
		{
			cp = this.skipline(cp);
			if (retval == Linetype.LT_TRUE || retval == Linetype.LT_FALSE ||
				retval == Linetype.LT_TRUEI || retval == Linetype.LT_FALSEI)
				retval = Linetype.LT_IF;
			if (retval == Linetype.LT_ELTRUE || retval == Linetype.LT_ELFALSE)
				retval = Linetype.LT_ELIF;
		}
		/* the following can only happen if the last line of the file lacks a newline */
		if (this.linestate == Line_state.LS_HASH)
		{
			this.debug("parser insert newline at EOF");
			this.tline += this.newline;
			cp = this.tline.length;
			this.linestate = Line_state.LS_START;
		}
		if (retval != Linetype.LT_PLAIN && (wascomment || this.linestate != Line_state.LS_START))
		{
			retval = linetype_2dodgy(retval);
			this.linestate = Line_state.LS_DIRTY;
		}

		return done();
	}

	/*
	 * An evaluation function takes three arguments, as follows: (1) a pointer to
	 * an element of the precedence table which lists the operators at the current
	 * level of precedence; (2) a pointer to an integer which will receive the
	 * value of the expression; and (3) a pointer to a char* that points to the
	 * expression to be evaluated and that is updated to the end of the expression
	 * when evaluation is complete. The function returns LT_FALSE if the value of
	 * the expression is zero, LT_TRUE if it is non-zero, LT_IF if the expression
	 * depends on an unknown symbol, or LT_ERROR if there is a parse failure.
	 */

	/**
	 * These are the binary operators that are supported by the expression
	 * evaluator.
	 * @param {number} p
	 * @param {number} v
	 * @param {Linetype} at
	 * @param {Linetype} bt
	 * @returns {[ Linetype, number ]}
	 */
	op_strict(p, v, at, bt)
	{
		if (at == Linetype.LT_IF || bt == Linetype.LT_IF)
			return [ Linetype.LT_IF, p ];
		return [ v ? Linetype.LT_TRUE : Linetype.LT_FALSE, v ];
	}
	/**
	 * @param {number} p
	 * @param {Linetype} at
	 * @param {number} a
	 * @param {Linetype} bt
	 * @param {number} b
	 */
	op_lt(p, at, a, bt, b)
	{
		return this.op_strict(p, a < b, at, bt);
	}
	/**
	 * @param {number} p
	 * @param {Linetype} at
	 * @param {number} a
	 * @param {Linetype} bt
	 * @param {number} b
	 */
	op_gt(p, at, a, bt, b)
	{
		return this.op_strict(p, a > b, at, bt);
	}
	/**
	 * @param {number} p
	 * @param {Linetype} at
	 * @param {number} a
	 * @param {Linetype} bt
	 * @param {number} b
	 */
	op_le(p, at, a, bt, b)
	{
		return this.op_strict(p, a <= b, at, bt);
	}
	/**
	 * @param {number} p
	 * @param {Linetype} at
	 * @param {number} a
	 * @param {Linetype} bt
	 * @param {number} b
	 */
	op_ge(p, at, a, bt, b)
	{
		return this.op_strict(p, a >= b, at, bt);
	}
	/**
	 * @param {number} p
	 * @param {Linetype} at
	 * @param {number} a
	 * @param {Linetype} bt
	 * @param {number} b
	 */
	op_eq(p, at, a, bt, b)
	{
		return this.op_strict(p, a == b, at, bt);
	}
	/**
	 * @param {number} p
	 * @param {Linetype} at
	 * @param {number} a
	 * @param {Linetype} bt
	 * @param {number} b
	 */
	op_ne(p, at, a, bt, b)
	{
		return this.op_strict(p, a != b, at, bt);
	}
	/**
	 * @param {number} p
	 * @param {Linetype} at
	 * @param {number} a
	 * @param {Linetype} bt
	 * @param {number} b
	 * @returns {[ Linetype, number ]}
	 */
	op_or(p, at, a, bt, b)
	{
		if (!this.settings.strictlogic && (at === Linetype.LT_TRUE || bt === Linetype.LT_TRUE))
			return [ Linetype.LT_TRUE, 1 ];
		return this.op_strict(p, a || b, at, bt);
	}
	/**
	 * @param {number} p
	 * @param {Linetype} at
	 * @param {number} a
	 * @param {Linetype} bt
	 * @param {number} b
	 * @returns {[ Linetype, number ]}
	 */
	op_and(p, at, a, bt, b)
	{
		if (!this.settings.strictlogic && (at == Linetype.LT_FALSE || bt == Linetype.LT_FALSE))
			return [ Linetype.LT_FALSE, 0 ];
		return this.op_strict(p, a && b, at, bt);
	}
	/**
	 * @param {number} p
	 * @param {Linetype} at
	 * @param {number} a
	 * @param {Linetype} bt
	 * @param {number} b
	 */
	op_blsh(p, at, a, bt, b)
	{
		return this.op_strict(p, a << b, at, bt);
	}
	/**
	 * @param {number} p
	 * @param {Linetype} at
	 * @param {number} a
	 * @param {Linetype} bt
	 * @param {number} b
	 */
	op_brsh(p, at, a, bt, b)
	{
		return this.op_strict(p, a >> b, at, bt);
	}
	/**
	 * @param {number} p
	 * @param {Linetype} at
	 * @param {number} a
	 * @param {Linetype} bt
	 * @param {number} b
	 */
	op_add(p, at, a, bt, b)
	{
		return this.op_strict(p, a + b, at, bt);
	}
	/**
	 * @param {number} p
	 * @param {Linetype} at
	 * @param {number} a
	 * @param {Linetype} bt
	 * @param {number} b
	 */
	op_sub(p, at, a, bt, b)
	{
		return this.op_strict(p, a - b, at, bt);
	}
	/**
	 * @param {number} p
	 * @param {Linetype} at
	 * @param {number} a
	 * @param {Linetype} bt
	 * @param {number} b
	 */
	op_mul(p, at, a, bt, b)
	{
		return this.op_strict(p, a * b, at, bt);
	}
	/**
	 * @param {number} p
	 * @param {Linetype} at
	 * @param {number} a
	 * @param {Linetype} bt
	 * @param {number} b
	 * @returns {[ Linetype, number ]}
	 */
	op_div(p, at, a, bt, b)
	{
		if (bt != Linetype.LT_TRUE)
		{
			this.debug("eval division by zero");
			return [ Linetype.LT_ERROR, p ];
		}
		return this.op_strict(p, a / b, at, bt);
	}
	/**
	 * @param {number} p
	 * @param {Linetype} at
	 * @param {number} a
	 * @param {Linetype} bt
	 * @param {number} b
	 */
	op_mod(p, at, a, bt, b)
	{
		return this.op_strict(p, a % b, at, bt);
	}
	/**
	 * @param {number} p
	 * @param {Linetype} at
	 * @param {number} a
	 * @param {Linetype} bt
	 * @param {number} b
	 */
	op_bor(p, at, a, bt, b)
	{
		return this.op_strict(p, a | b, at, bt);
	}
	/**
	 * @param {number} p
	 * @param {Linetype} at
	 * @param {number} a
	 * @param {Linetype} bt
	 * @param {number} b
	 */
	op_bxor(p, at, a, bt, b)
	{
		return this.op_strict(p, a ^ b, at, bt);
	}
	/**
	 * @param {number} p
	 * @param {Linetype} at
	 * @param {number} a
	 * @param {Linetype} bt
	 * @param {number} b
	 */
	op_band(p, at, a, bt, b)
	{
		return this.op_strict(p, a & b, at, bt);
	}

	/*
	 * The precedence table. Expressions involving binary operators are evaluated
	 * in a table-driven way by eval_table. When it evaluates a subexpression it
	 * calls the inner function with its first argument pointing to the next
	 * element of the table. Innermost expressions have special non-table-driven
	 * handling.
	 *
	 * The stop characters help with lexical analysis: an operator is not
	 * recognized if it is followed by one of the stop characters because
	 * that would make it a different operator.
	 */
	/*struct op
	{
		using op_fn = std::tuple<Linetype, int>(unifdef &, int, Linetype, int, Linetype, int);
		const char *str;
		op_fn *fn;
		const std::string stop = "";
	};*/
	/*struct ops
	{
		using eval_fn = std::tuple<Linetype, int, size_t>(unifdef &, const ops *, int, size_t);
		eval_fn *inner;
		op op[5];
	};*/

	/** Current operator precedence level
	 * @param {unifdefops} ops
	 */
	prec(ops)
	{
		let i = 0;

		for (const op of this.eval_ops)
		{
			if (op === ops)
				break;
			i++;
		}

		return i;
	}

	/**
	 * @param {string} str
	 * @param {number} offset
	 */
	find_int(str, offset)
	{
		const regex = /[^-1234567890]/y;
		regex.lastIndex = offset;
		let end = str.search(regex);

		if (end === 0)
			return [ end, 0 ];
		else if (end === -1)
			end = str.length;

		return [ end, Number.parseInt(str.substr(offset, end - offset)) ];
	}

	/**
	 * Function for evaluating the innermost parts of expressions,
	 * viz. !expr (expr) number defined(symbol) symbol
	 * We reset the constexpr flag in the last two cases.
	 * @param {unifdefops} ops
	 * @param {number} valp
	 * @param {number} cpp
	 * @returns {[ Linetype, number, number ]}
	 */
	eval_unary(ops, valp, cpp)
	{
		/** @type {Linetype} */
		let lt;
		let cp = this.skipcomment(cpp);

		if (this.tline[cp] === '!')
		{
			this.debug("eval" + this.prec(ops) + " !");
			cp++;
			const [ _lt, _valp, _cp ] = this.eval_unary(ops, valp, cp);
			cp = _cp;
			valp = _valp;
			lt = _lt;
			if (lt == Linetype.LT_ERROR)
				return [ Linetype.LT_ERROR, valp, cpp ];
			if (lt != Linetype.LT_IF)
			{
				valp = !valp;
				lt = valp ? Linetype.LT_TRUE : Linetype.LT_FALSE;
			}
		}
		else if (this.tline[cp] === '~')
		{
			this.debug("eval" + this.prec(ops) + " ~");
			cp++;
			const [ _lt, _valp, _cp ] = this.eval_unary(ops, valp, cp);
			cp = _cp;
			valp = _valp;
			lt = _lt;
			if (lt == Linetype.LT_ERROR)
				return [ Linetype.LT_ERROR, valp, cpp ];
			if (lt != Linetype.LT_IF)
			{
				valp = ~valp;
				lt = valp ? Linetype.LT_TRUE : Linetype.LT_FALSE;
			}
		}
		else if (this.tline[cp] === '-')
		{
			this.debug("eval" + this.prec(ops) + " -");
			cp++;
			const [ _lt, _valp, _cp ] = this.eval_unary(ops, valp, cp);
			cp = _cp;
			valp = _valp;
			lt = _lt;
			if (lt == Linetype.LT_ERROR)
				return [ Linetype.LT_ERROR, valp, cpp ];
			if (lt != Linetype.LT_IF)
			{
				valp = -valp;
				lt = valp ? Linetype.LT_TRUE : Linetype.LT_FALSE;
			}
		}
		else if (this.tline[cp] === '(')
		{
			cp++;
			this.debug("eval" + this.prec(ops) + " (");
			const [ _lt, _valp, _cp ] = this.eval_table(this.eval_ops[0], valp, cp);
			lt = _lt;
			valp = _valp;
			cp = _cp;
			if (lt == Linetype.LT_ERROR)
				return [ Linetype.LT_ERROR, valp, cpp ];
			cp = this.skipcomment(cp);
			if (this.tline[cp++] != ')')
				return [ Linetype.LT_ERROR, valp, cpp ];
		}
		else if (digit.test(this.tline[cp]))
		{
			this.debug("eval" + this.prec(ops) + " number");
			const [ end, value ] = this.find_int(this.tline, cp);
			if (!end)
				return [ Linetype.LT_ERROR, valp, cpp ];
			valp = value;
			lt = valp ? Linetype.LT_TRUE : Linetype.LT_FALSE;
			cp = end;
		}
		else if (this.matchsym("defined", this.tline, cp) !== -1)
		{
			cp = this.skipcomment(cp + 7);

			let defparen = false;

			if (this.tline[cp] === '(')
			{
				cp = this.skipcomment(cp+1);
				defparen = true;
			}

			const [ sym, _cp ] = this.findsym(this.tline, cp);
			cp = _cp;
			cp = this.skipcomment(cp);
			if (defparen && this.tline[cp++] !== ')')
			{
				this.debug("eval" + this.prec(ops) + " defined missing ')'");
				return [ Linetype.LT_ERROR, valp, cpp ];
			}
			
			if (sym === -1)
			{
				this.debug("eval" + this.prec(ops) + " defined unknown");
				lt = Linetype.LT_IF;
			}
			else
			{
				this.debug("eval" + this.prec(ops) + " defined " + this.symbols[sym].name);
				valp = this.symbols[sym].value != null;
				lt = valp ? Linetype.LT_TRUE : Linetype.LT_FALSE;
			}
			this.constexprs = false;
		}
		else if (!this.endsym(this.tline[cp]))
		{
			this.debug("eval" + this.prec(ops) + " symbol");
			const [ sym, _cp ] = this.findsym(this.tline, cp);
			cp = _cp;
			if (sym == -1)
			{
				lt = Linetype.LT_IF;
				cp = this.skipargs(cp);
			}
			else if (this.symbols[sym].value === null)
			{
				valp = 0;
				lt = Linetype.LT_FALSE;
			}
			else
			{
				const [ end, value ] = this.find_int(this.symbols[sym].value, 0);
				if (end !== this.symbols[sym].value.length)
					return [ Linetype.LT_ERROR, valp, cpp ];
				valp = value;
				lt = valp ? Linetype.LT_TRUE : Linetype.LT_FALSE;
				cp = this.skipargs(cp);
			}
			this.constexprs = false;
		}
		else
		{
			this.debug("eval" + this.prec(ops) + " bad expr");
			return [ Linetype.LT_ERROR, valp, cpp ];
		}

		this.debug("eval" + this.prec(ops) + " = " + valp);
		return [ lt, valp, cp ];
	}

	/**
	 * Table-driven evaluation of binary operators.
	 * @param {unifdefops} ops
	 * @param {number} valp
	 * @param {number} cpp
	 * @returns {[ Linetype, number, number ]}
	 */
	eval_table(ops, valp, cpp)
	{
		let val = 0;
		
		this.debug("eval" + this.prec(ops));
		let cp = cpp;
		const [ _lt, _valp, _cp ] = ops.inner.call(this, this.eval_ops[this.eval_ops.indexOf(ops) + 1], valp, cp);
		let lt = _lt;
		valp = _valp;
		cp = _cp;
		if (lt == Linetype.LT_ERROR)
			return [ Linetype.LT_ERROR, valp, cpp ];
		for (;;)
		{
			/** @type {unifdefop} */
			let op;
			let opi = 0;

			cp = this.skipcomment(cp);
			for (; opi < ops.op.length && ops.op[opi].str; opi++)
			{
				op = ops.op[opi];

				if (this.tline.substr(cp, op.str.length) === op.str)
				{
					/* assume only one-char operators have stop chars */
					if (op.stop && (cp + 1) != this.tline.length &&
						op.stop.search(this.tline[cp + 1]) !== -1)
						continue;
					else
						break;
				}
			}
			if (opi >= ops.op.length || !op.str)
				break;
			cp += op.str.length;
			this.debug("eval" + this.prec(ops) + " " + op.str);
			const [ _rt, _val, __cp ] = ops.inner.call(this, this.eval_ops[this.eval_ops.indexOf(ops) + 1], val, cp);
			let rt = _rt;
			val = _val;
			cp = __cp;
			if (rt == Linetype.LT_ERROR)
				return [ Linetype.LT_ERROR, valp, cpp ];
			const [ __lt, __valp ] = op.fn.call(this, valp, lt, valp, rt, val);
			lt = __lt;
			valp = __valp;
		}

		this.debug("eval" + this.prec(ops) + " = " + valp);
		this.debug("eval" + this.prec(ops) + " lt = " + linetype_name[lt]);
		return [ lt, valp, cp ];
	}

	/**
	 * Evaluate the expression on a #if or #elif line. If we can work out
	 * the result we return LT_TRUE or LT_FALSE accordingly, otherwise we
	 * return just a generic LT_IF.
	 * @param {number} cpp
	 * @return {[ Linetype, number ]}
	 */
	ifeval(cpp)
	{
		let val = 0;
		this.debug("eval " + cpp);
		this.constexprs = !this.settings.killconsts;
		const [ ret, _val, _cpp ] = this.eval_table(this.eval_ops[0], val, cpp);
		val = _val;
		cpp = _cpp;
		this.debug("eval = " + val);
		return [ this.constexprs ? Linetype.LT_IF : ret === Linetype.LT_ERROR ? Linetype.LT_IF : ret, cpp ];
	}

	/**
	 * Read a line and examine its initial part to determine if it is a
	 * preprocessor directive. Returns NULL on EOF, or a pointer to a
	 * preprocessor directive name, or a pointer to the zero byte at the
	 * end of the line.
	 * @param {string} v
	 */
	skiphash(v)
	{
		this.linenum++;

		this.tline = '';

		for (;;)
		{
			if (this.inputpos == v.length)
			{
				if (this.tline.length)
					break;

				return -1;
			}

			const c = v[this.inputpos++];
			this.tline += c;

			if (c == '\n')
				break;
		}

		const cp = this.skipcomment(0);
		if (this.linestate == Line_state.LS_START && this.tline[cp] == '#')
		{
			this.linestate = Line_state.LS_HASH;
			return (this.skipcomment(cp + 1));
		}
		else if (cp == this.tline.length)
			return (cp);
		else
			return (this.skipline(cp));
	}

	/**
	 * Mark a line dirty and consume the rest of it, keeping track of the
	 * lexical state.
	 * @param {number} cp
	 */
	skipline(cp)
	{
		if (cp != this.tline.length)
			this.linestate = Line_state.LS_DIRTY;
		while (cp != this.tline.length)
		{
			const pcp = cp;
			cp = this.skipcomment(pcp);
			if (pcp == cp)
				cp++;
		}
		return (cp);
	}

	/**
	 * Skip over comments, strings, and character literals and stop at the
	 * next character position that is not whitespace. Between calls we keep
	 * the comment state in the global variable incomment, and we also adjust
	 * the global variable linestate when we see a newline.
	 * XXX: doesn't cope with the buffer splitting inside a state transition.
	 * @param {number} cp
	 */
	skipcomment(cp)
	{
		if (this.settings.text || this.states[this.states.length - 1].ignored)
		{
			for (; spaceornew.test(this.tline[cp]); cp++)
				if (this.tline[cp] === '\n')
					this.linestate = Line_state.LS_START;
			return (cp);
		}
		while (cp != this.tline.length)
		{
			/* don't reset to LS_START after a line continuation */
			if (this.tline.substr(cp, 3) == "\\\r\n")
				cp += 3;
			else if (this.tline.substr(cp, 2) == "\\\n")
				cp += 2;
			else switch (this.incomment)
			{
			case Comment_state.NO_COMMENT:
				if (this.tline.substr(cp, 4) == "/\\\r\n")
				{
					this.incomment = Comment_state.STARTING_COMMENT;
					cp += 4;
				}
				else if (this.tline.substr(cp, 3) == "/\\\n")
				{
					this.incomment = Comment_state.STARTING_COMMENT;
					cp += 3;
				}
				else if (this.tline.substr(cp, 2) == "/*")
				{
					this.incomment = Comment_state.C_COMMENT;
					cp += 2;
				}
				else if (this.tline.substr(cp, 2) == "//")
				{
					this.incomment = Comment_state.CXX_COMMENT;
					cp += 2;
				}
				else if (this.tline[cp] == '\'')
				{
					this.incomment = Comment_state.CHAR_LITERAL;
					this.linestate = Line_state.LS_DIRTY;
					cp += 1;
				}
				else if (this.tline[cp] == '"')
				{
					this.incomment = Comment_state.STRING_LITERAL;
					this.linestate = Line_state.LS_DIRTY;
					cp += 1;
				}
				else if (this.tline.substr(cp, 3) == "R\"(")
				{
					this.incomment = Comment_state.RAW_STRING_LITERAL;
					this.linestate = Line_state.LS_DIRTY;
					cp += 3;
				}
				else if (this.tline[cp] == '\n')
				{
					this.linestate = Line_state.LS_START;
					cp += 1;
				}
				else if (this.isspacenotnew(this.tline[cp]))
					cp += 1;
				else
					return (cp);
				continue;
			case Comment_state.CXX_COMMENT:
				if (this.tline[cp] == '\n')
				{
					this.incomment = Comment_state.NO_COMMENT;
					this.linestate = Line_state.LS_START;
				}
				cp += 1;
				continue;
			case Comment_state.CHAR_LITERAL:
			case Comment_state.STRING_LITERAL:
				if ((this.incomment == Comment_state.CHAR_LITERAL && this.tline[cp] == '\'') ||
					(this.incomment == Comment_state.STRING_LITERAL && this.tline[cp] == '"'))
				{
					this.incomment = Comment_state.NO_COMMENT;
					cp += 1;
				}
				else if (this.tline[cp] === '\\')
				{
					if ((cp + 1) === this.tline.length)
						cp += 1;
					else
						cp += 2;
				}
				else if (this.tline[cp] === '\n')
				{
					if (this.incomment == Comment_state.CHAR_LITERAL)
						this.error("Unterminated char literal");
					else
						this.error("Unterminated string literal");
				}
				else
					cp += 1;
				continue;
			case Comment_state.RAW_STRING_LITERAL:
				if (this.tline.substr(cp, 2) === ")\"")
				{
					this.incomment = Comment_state.NO_COMMENT;
					cp += 2;
				}
				else
					cp += 1;
				continue;
			case Comment_state.C_COMMENT:
				if (this.tline.substr(cp, 4) === "*\\\r\n")
				{
					this.incomment = Comment_state.FINISHING_COMMENT;
					cp += 4;
				}
				else if (this.tline.substr(cp, 3) === "*\\\n")
				{
					this.incomment = Comment_state.FINISHING_COMMENT;
					cp += 3;
				}
				else if (this.tline.substr(cp, 2) == "*/")
				{
					this.incomment = Comment_state.NO_COMMENT;
					cp += 2;
				}
				else
					cp += 1;
				continue;
			case Comment_state.STARTING_COMMENT:
				if (this.tline[cp] === '*')
				{
					this.incomment = Comment_state.C_COMMENT;
					cp += 1;
				}
				else if (this.tline[cp] === '/')
				{
					this.incomment = Comment_state.CXX_COMMENT;
					cp += 1;
				}
				else
				{
					this.incomment = Comment_state.NO_COMMENT;
					this.linestate = Line_state.LS_DIRTY;
				}
				continue;
			case Comment_state.FINISHING_COMMENT:
				if (this.tline[cp] === '/')
				{
					this.incomment = Comment_state.NO_COMMENT;
					cp += 1;
				}
				else
					this.incomment = Comment_state.C_COMMENT;
				continue;
			default:
				this.abort(); /* bug */
			}
		}
		return (cp);
	}

	/**
	 * Skip macro arguments.
	 * @param {number} cp
	 */
	skipargs(cp)
	{
		const ocp = cp;
		cp = this.skipcomment(cp);

		if (this.tline[cp] !== '(')
			return (cp);

		let level = 0;

		do
		{
			if (this.tline[cp] == '(')
				level++;
			if (this.tline[cp] == ')')
				level--;
			cp = this.skipcomment(cp+1);
		} while (level != 0 && cp != this.tline.length);
		
		if (level == 0)
			return (cp);
		else
			return (ocp); /* Rewind and re-detect the syntax error later. */
	}

	/**
	 * Skip over an identifier.
	 * @param {string} base
	 * @param {number} cp
	 */
	skipsym(base, cp)
	{
		while (!this.endsym(base[cp]))
			++cp;
		return (cp);
	}

	/**
	 * Skip whitespace and take a copy of any following identifier.
	 * @param {number} cpp
	 * @return {[ string, number ]}
	 */
	getsym(cpp)
	{
		let cp = cpp;
		cp = this.skipcomment(cp);
		const sym = cp;
		cp = this.skipsym(this.tline, sym);
		if (cp == sym)
			return [ "", cpp ];
		return [ this.tline.substr(sym, cp - sym), cp ];
	}

	/**
	 * Check that s (a symbol) matches the start of t, and that the
	 * following character in t is not a symbol character. Returns a
	 * pointer to the following character in t if there is a match,
	 * otherwise NULL.
	 * @param {string} s
	 * @param {string} base
	 * @param {number} offset
	 */
	matchsym(s, base, offset)
	{
		let so = 0;

		while (so < s.length && offset < base.length)
		{
			if (s[so] !== base[offset])
				return (-1);
			else
				++so, ++offset;
		}

		if (so === s.length && this.endsym(base[offset]))
			return(offset);
		else
			return(-1);
	}

	/**
	 * Look for the symbol in the symbol table. If it is found, we return
	 * the symbol table index, else we return -1.
	 * @param {string} base
	 * @param {number} offset
	 * @return {[ number, number ]}
	 */
	findsym(base, offset)
	{
		let str = offset;
		let new_offset = this.skipsym(base, str);
		if (this.settings.symlist)
		{
			if (new_offset == str)
				return [ -1, new_offset ];
			if (this.settings.symdepth && this.firstsym)
				this.output.output += (this.zerosyms ? "" : "\n") + this.states.length;
			this.firstsym = this.zerosyms = false;
			this.output.output += (this.settings.symdepth ? " " : "") + base.substr(str, new_offset - str) + (this.settings.symdepth ? "" : "\n");
			/* we don't care about the value of the symbol */
			return [ 0, new_offset ];
		}
		for (let symind = 0; symind < this.symbols.length; ++symind)
		{
			if (this.matchsym(this.symbols[symind].name, base, str) != -1)
			{
				this.debugsym("findsym", symind);
				return [ symind, new_offset ];
			}
		}
		return [ -1, new_offset ];
	}

	/*
	 * Resolve indirect symbol values to their final definitions.
	 */
	indirectsym()
	{
		let changed;

		do
		{
			changed = 0;
			for (let sym = 0; sym < this.symbols.length; ++sym)
			{
				if (this.symbols[sym].value === null)
					continue;
				const cp = this.symbols[sym].value;
				const [ ind ] = this.findsym(cp, 0);
				if (ind === -1 || ind === sym ||
					cp[0] != '\0' ||
					this.symbols[ind] === null ||
					this.symbols[ind].value === this.symbols[sym].value)
					continue;
				this.debugsym("indir...", sym);
				this.symbols[sym].value = this.symbols[ind].value;
				this.debugsym("...ectsym", sym);
				changed++;
			}
		} while (changed);
	}

	/**
	 * @param {string} why
	 * @param {number} symind
	 */
	debugsym(why, symind)
	{
		this.debug(why + " " + this.symbols[symind].name + ((this.symbols[symind].value && this.symbols[symind].value.length) ? '=' : ' ') + ((this.symbols[symind].value && this.symbols[symind].value.length) ? this.symbols[symind].value : "undef"));
	}

	/*
	 * Add symbols to the symbol table from a file containing
	 * #define and #undef preprocessor directives.
	 */
	defundefile()
	{
		this.linenum = 0;
		while (this.defundef())
			;
		this.inputpos = 0;
		if (this.incomment)
			this.error("EOF in comment");
	}

	/*
	 * Read and process one #define or #undef directive
	 */
	defundef()
	{
		let cp = this.skiphash(this.input.defundef);

		const done = () =>
		{
			this.debug("parser line " + this.linenum + "state " + comment_name[this.incomment] + " comment " + linestate_name[this.linestate] + " line");
			return (true);
		}

		if (cp == -1)
			return (false);
		if (cp === this.tline.length)
			return done();
		/* strip trailing whitespace, and do a fairly rough check to
		   avoid unsupported multi-line preprocessor directives */
		let end = this.tline.length;
		while (end > 0 && this.isspaceornew(this.tline[end - 1]))
			--end;
		if (end > 0 && this.tline[end - 1] == '\\')
			this.Eioccc();

		let kw = cp;
		if ((cp = this.matchsym("define", this.tline, kw)) != -1)
		{
			let val;
			const [ sym, _cp ] = this.getsym(cp);
			cp = _cp;
			if (!sym.length)
				this.error("Missing macro name in #define");
			if (this.tline[cp] == '(')
				val = "1";
			else
			{
				cp = this.skipcomment(cp);
				val = (cp < end) ? this.tline.substr(cp, end - cp) : "";
			}
			this.debug("#define");
			this.addsym(false, sym, val);
		}
		else if ((cp = this.matchsym("undef", this.tline, kw)) != -1)
		{
			const [ sym, _cp ] = this.getsym(cp);
			cp = _cp;
			if (!sym.length)
				this.error("Missing macro name in #undef");
			cp = this.skipcomment(cp);
			this.debug("#undef");
			this.addsym(false, sym, "");
		}
		else
			this.error("Unrecognized preprocessor directive");

		this.skipline(cp);
		return done();
	}

	/**
	 * Diagnostics.
	 * @param {string} msg
	 */
	debug(msg)
	{
		if (this.settings.debugging)
			this.output.output += "/*" + msg + "*/";
	}

	/** @param {string} msg */
	error(msg)
	{
		this.closeio();
		throw new Error(msg);
	}
}

/**
 * @param {unifdefsettings} settings 
 * @param {unifdefinput} input
 */
export default function unifdef(settings, input)
{
	/** @type {unifdefoutput} */ 
	const out = {
		altered: false,
		output: ''
	};
	const processor = new unifdef_(settings, input, out);
	processor.start();
	return out;
}

/*int main(int argc, char *argv[])
{
	std::string input;
	std::fstream input_stream("in.c", std::ios_base::in | std::ios_base::binary);
	input.assign(std::istreambuf_iterator<char> { input_stream }, std::istreambuf_iterator<char> { });
	input_stream.close();

	auto output = unifdef::run({
		.killconsts = true
	}, {
		.input = input,
		.defundef = "#define FOO 1\r\n#define FOOB 42\r\n"
	});

	std::fstream output_stream("out.c", std::ios_base::out | std::ios_base::binary | std::ios_base::trunc);
	output_stream.write(output.output.data(), output.output.length);
	output_stream.close();
}*/