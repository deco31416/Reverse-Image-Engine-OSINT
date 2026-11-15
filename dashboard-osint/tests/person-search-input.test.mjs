import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../lib/person-search-input.ts',import.meta.url),'utf8');
const compiled = ts.transpileModule(source,{ compilerOptions:{ module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022 } }).outputText;
const { inferPersonIdentity, getPersonSearchIdentity, validatePersonSearchInput } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

for (const [value, expected] of [
  ['  Laura   Gómez Pérez  ', { nombre: 'Laura Gómez Pérez' }],
  ['@laura.gomez', { username: 'laura.gomez' }],
  ['laura@example.com', { email: 'laura@example.com' }],
  ['+57 (300) 123-4567', { telefono: '+573001234567' }],
  ['300 123 4567', { telefono: '3001234567' }],
  ['   ', {}],
]) test(`maps one input into the existing API identity: ${value}`, () => assert.deepEqual(inferPersonIdentity(value), expected));

test('rejects incomplete or ambiguous handles and email addresses', () => {
  for (const value of ['@', '@laura gomez', 'laura@', 'laura@example']) assert.throws(() => inferPersonIdentity(value));
});
test('preserves optional structured fields and explicit overrides', () => {
  const form = new FormData();
  form.set('searchTerm', 'Laura Gómez'); form.set('nombre', 'Laura'); form.set('apellido','Gómez'); form.set('ciudad','Bogotá'); form.set('alias','lg');
  assert.deepEqual(getPersonSearchIdentity(form), { nombre:'Laura', apellido:'Gómez', ciudad:'Bogotá', alias:'lg' });
});
test('accepts an advanced identifier without the main input', () => {
  const form = new FormData(); form.set('email','laura@example.com');
  assert.doesNotThrow(() => validatePersonSearchInput(form));
});
test('blocks blank and context-only submissions before creating a case', () => {
  const form = new FormData(); assert.throws(() => validatePersonSearchInput(form));
  form.set('ciudad','Bogotá'); form.set('notas','Solo contexto'); assert.throws(() => validatePersonSearchInput(form));
});
test('preserves image-only searches from upload, URL and Datasec', () => {
  for(const [key,value] of [['imageUrl','https://example.com/photo.png'],['datasecAssetId','existing-image-id'],['imageFile',new File(['fixture'],'fixture.png',{type:'image/png'})]]) {
    const form=new FormData(); form.set(key,value); assert.doesNotThrow(() => validatePersonSearchInput(form));
  }
});
test('validates optional email fields even when More options is collapsed', () => {
  const form = new FormData(); form.set('searchTerm','Laura'); form.set('email','invalid'); assert.throws(() => validatePersonSearchInput(form));
});

test('rejects incomplete and oversized phone numbers', () => {
  for(const value of ['+57','12345','1234567890123456']) assert.throws(()=>inferPersonIdentity(value));
});
