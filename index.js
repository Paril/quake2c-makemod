// @ts-check
import rl from 'readline';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import os from 'os';
import { spawn } from 'child_process';
import unifdef from './unifdef.js';

let modDirectory;
/** @type {import('./unifdef').unifdefsymbol[]} */
const unifdefSymbols = [];

const readline = rl.createInterface({
	input: process.stdin,
	output: process.stdout
});

/** @returns {Promise<string>} */
const questionPromise = prompt => new Promise(resolve => { readline.question(`${prompt}\r\n> `, resolve); } );

/** @returns {Promise<number>} */
const processWrap = cmd => {
	return new Promise(resolve => {
		const process = spawn(cmd[0], cmd.slice(1), {
			stdio: 'inherit'
		});

		process.on('close', resolve);
		process.on('exit', resolve);
		process.on('error', resolve);
	});
}

/**
 * @param {string} file 
 * @param {string} relative 
 * @param {Set<string>} includes 
 */
const processFile = async(file, relative, includes) => {
	console.log(`Processing ${relative}...`);
	/** @type {import('./unifdef').unifdefsettings} */
	const settings = {
		compblank: true,
		strictlogic: true
	};
	/** @type {import('./unifdef').unifdefinput} */
	const input = {
		input: (await fs.readFile(file)).toString('utf8'),
		symbols: unifdefSymbols
	};
	const output = unifdef(settings, input);
	const fileData = output.output.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1');

	if (!fileData.trim().length)
	{
		await fs.unlink(file);
		return false;
	}

	const includeRegex = /#include\s*?"(.*?)"/g;
	const fileDir = path.parse(file).dir;
	let includedFile;

	while ((includedFile = includeRegex.exec(fileData)) !== null)
	{
		const includedAbsolute = path.join(fileDir, includedFile[1]);

		if (!includes.has(includedAbsolute))
			processFile(includedAbsolute, path.relative(fileDir, includedAbsolute), includes);

		includes.add(includedAbsolute);
	}

	if (output.altered)
		await fs.writeFile(file, output.output);

	return true;
};

/**
 * @param {import('fs').Dir} dir
 * @param {Set<string>} includes
 */
const processFolder = async(dir, includes) => {
	let ent;

	while ((ent = dir.readSync()))
	{
		if (ent.isDirectory())
		{
			if (ent.name[0] !== '.')
				await processFolder(await fs.opendir(path.join(dir.path, ent.name)), includes);
			continue;
		}

		const ext = path.extname(ent.name);

		if (ext !== '.qc' && ext !== '.h')
			continue;

		const fullPath = path.join(dir.path, ent.name);

		if (!includes.has(fullPath))
			await fs.unlink(fullPath);
	}

	const dirPath = dir.path;
	dir.closeSync();
	dir = await fs.opendir(dirPath);

	// we became an emptyboi
	if (!dir.readSync())
	{
		dir.closeSync();
		fs.rmdir(dir.path);
	}
	else
		dir.closeSync();
};

const processSource = async(progsrc) => {
	const dir = path.parse(progsrc).dir;
	const ext = (await fs.readFile(path.join(dir, 'config.qc'))).toString('utf8');
	const optionFinder = /\/\* @(.*?)@ ([\s\S]*?) \*\//g;
	let option;
	const macros = [];

	while ((option = optionFinder.exec(ext)) !== null)
	{
		macros.push({
			macro: option[1],
			description: option[2].replace(/\r?\n/, ' '),
			value: null
		});
	}

	console.log("\r\nQuake2C's main progs includes several optional components.\r\nWhich of them would you like to KEEP? You'll be asked for each one of them;\r\nenter Y to keep, N to discard, or leave blank to keep optional.\r\nYou can control these manually via config.qc later, but your source will be heavier.\r\n");

	for (const macro of macros)
	{
		const answer = (await questionPromise(`${macro.macro}; ${macro.description}`)).toLowerCase();
		macro.value = (answer[0] === 'y') ? true : (answer[0] === 'n') ? false : null;
	}

	for (const macro of macros)
	{
		console.log(` - ${macro.macro}: ${macro.value === true ? 'resolve as true' : macro.value === false ? 'resolve as false' : 'leave alone'}`);

		if (macro.value === true)
			unifdefSymbols.push({ name: macro.macro, value: "1", ignored: false });
		else if (macro.value === false)
			unifdefSymbols.push({ name: macro.macro, value: null, ignored: false });
	}

	const lines = (await fs.readFile(progsrc)).toString('utf8').split(/\r?\n/);
	/** @type {Set<string>} */
	const includes = new Set();

	for (let i = 1; i < lines.length; i++)
	{
		if (!lines[i].trim().length)
			continue;

		const file = path.join(dir, lines[i]);

		if (!(await processFile(file, lines[i], includes)))
		{
			lines.splice(i, 1);
			i--;
		}
		else
			includes.add(file);
	}

	await fs.writeFile(progsrc, lines.join(os.EOL));

	// recursively enumerate the output folder, removing unused .qc and .h files
	await processFolder(await fs.opendir(dir), includes);
};

const main = async() => {
	for (;;)
	{
		console.clear();
		console.log("Quake2C Mod Creator\n========================");
		modDirectory = path.resolve(await questionPromise("Enter directory for your new mod. It can either be an existing Quake2C repo or a directory that doesn't exist yet."), "progs.src");

		console.log("\r\nPlease check to be sure the following path is correct.\r\n");

		console.log(` - Mod Path: ${modDirectory}`)

		const progsExist = existsSync(modDirectory) && (await fs.stat(modDirectory)).isFile();

		if (progsExist)
			console.log('  - Appears to contain an existing mod. Will parse the mod in-place; be sure you\'ve made a backup!');
		else
		{
			const dir = path.parse(modDirectory).dir;
			const dirExists = existsSync(dir) && (await fs.stat(dir)).isDirectory();
			
			if (dirExists)
				console.log('  - Does not appear to contain an existing mod, but the folder exists. This will checkout Quake2C progs to this folder. Be sure it\'s empty!');
			else
				console.log('  - Folder does not exist. This will checkout Quake2C progs to this folder.');
		}

		if ((await questionPromise('Is this okay? Y or N')).toLowerCase()[0] === 'y')
			break;
	}

	console.clear();

	// progs.src exists? easy, start from there!
	if (existsSync(modDirectory) && (await fs.stat(modDirectory)).isFile())
		await processSource(modDirectory);
	else
	{
		const dir = path.parse(modDirectory).dir;

		// make folder
		await fs.mkdir(dir, { recursive: true });

		// run checkout
		const result = await processWrap([ 'git', 'clone', '--progress', 'https://github.com/Paril/quake2c-progs.git', dir ]);

		if (result !== 0)
		{
			console.log('Error occurred, stopping!');
			return;
		}

		console.log('Clone succeeded!');
		await processSource(modDirectory);
	}

	console.log('Done! Be sure to visit http://triptohell.info/moodles/fteqcc/ to get a copy of FTEQCC! It\'s the only compiler that works with Quake2C.');
};

main().finally(process.exit);