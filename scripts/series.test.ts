import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import Fastify from 'fastify';
import { seriesReference, summarizeSeries, type SeriesBook } from '../shared/series.js';
import catalogue from '../shared/series-catalogue.json' with { type: 'json' };

const reference = (publication = 'finished', volumes = [1, 2, 3].map(number => ({ number, title: `Книга ${number}` }))) => seriesReference.parse({ name: 'Цикл', publication, volumes });
const book = (id: number, start: number | null, end: number | null = null): SeriesBook => ({ id, isbn: `isbn-${id}`, title: `Издание ${id}`, series: 'Цикл', seriesOrder: start, seriesEnd: end, tags: [] });

test('no Russian edition found is a dated research result, never a complete empty series', () => {
  const r = seriesReference.parse({ name: 'Цикл', publication: 'untranslated', volumes: [], checkedAt: '2026-09-29', sources: ['https://example.com/catalogue'], note: 'Русское издание не найдено' });
  const s = summarizeSeries(r.name, [{...book(1, 1), tags: ['на английском']}], r);
  assert.equal(s.status, 'untranslated'); assert.equal(s.total, null);
  assert.deepEqual(s.unplaced, []); assert.deepEqual(s.missing, []);
  for (const patch of [{checkedAt:null}, {sources:[]}, {note:''}, {volumes:[{number:1,title:'Книга'}]}]) {
    assert.equal(seriesReference.safeParse({...r,...patch}).success,false);
  }
});

test('curated catalogue reconciles actual omnibus ISBNs and split volume 12', () => {
  const refs=catalogue.map(r=>seriesReference.parse(r));
  assert.equal(new Set(refs.map(r=>r.name)).size,refs.length);
  const check=(name:string,isbn:string,start:number|null)=>{
    const r=refs.find(r=>r.name===name)!; assert(r);
    return summarizeSeries(name,[{...book(1,start),series:name,isbn}],r);
  };
  assert.equal(check('Лотар','5699049932',null).status,'complete');
  assert.equal(check('Лотар','5699049932',null).owned,8);
  assert.equal(check('Белорский цикл','9785002422531',1).owned,2);
  assert.deepEqual(check('Конан-киммериец','9785604989005',null).missing.map(v=>v.key),['1','3','4']);
  assert.deepEqual(check('Гиганты','9785605192206',null).missing.map(v=>v.key),['2','3']);
  const split=check('Королевская кровь','9785517131287',12);
  assert.equal(split.owned,1); assert(split.missing.some(v=>v.key==='12.2'));
});

test('missing beginning, middle and final volumes; omnibus and duplicates count works once', () => {
  const r = reference();
  assert.deepEqual(summarizeSeries('Цикл', [book(1, 2)], r).missing.map(v => v.key), ['1', '3']);
  assert.deepEqual(summarizeSeries('Цикл', [book(1, 1), book(2, 3)], r).missing.map(v => v.key), ['2']);
  const s = summarizeSeries('Цикл', [book(1, 1, 2), book(2, 2), book(3, 3)], r);
  assert.equal(s.owned, 3); assert.equal(s.status, 'complete');
});
test('unknown end, unnumbered books, foreign editions and out-of-range numbers never imply completeness', () => {
  const s = summarizeSeries('Цикл', [book(1, 2)], null);
  assert.equal(s.total, null); assert.equal(s.status, 'unknown'); assert.deepEqual(s.gaps, [1]);
  for (const b of [book(4, null), book(4, 4), { ...book(4, 1), tags: ['на английском'] }]) {
    assert.equal(summarizeSeries('Цикл', [book(1, 1, 3), b], reference()).status, 'unknown');
  }
  assert.equal(summarizeSeries('Цикл', [book(1, 1, 3)], reference('ongoing')).status, 'current');
  assert.equal(summarizeSeries('Цикл', [book(1, 1, 3)], reference('unknown')).status, 'unknown');
});
test('split books require both parts; verified ISBN coverage can reconcile omnibus editions', () => {
  const r = seriesReference.parse({ name: 'Цикл', publication: 'finished', volumes: [{number:1,part:1,title:'Часть 1'}, {number:1,part:2,title:'Часть 2'}] });
  const first = { ...book(1, 1), seriesPart: 1 };
  assert.deepEqual(summarizeSeries('Цикл', [first, {...first,id:2}], r).missing.map(v => v.key), ['1.2']);
  assert.equal(summarizeSeries('Цикл', [first,{...book(2,1),seriesPart:2}],r).status,'complete');
  assert.equal(summarizeSeries('Цикл', [book(1,1)],r).status,'unknown');
  r.coverage['isbn-1']=['1.1','1.2'];
  assert.equal(summarizeSeries('Цикл',[{...book(1,null),tags:['на английском']}],r).status,'complete');
  assert.equal(seriesReference.safeParse({...r,volumes:[...r.volumes,r.volumes[0]]}).success,false);
  assert.equal(seriesReference.safeParse({...r,coverage:{x:['99']}}).success,false);
});
test('API persists reference edits, rechecks ownership after deletion and safely migrates existing records', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'kartoteka-series-'));
  assert(resolve(temp).startsWith(resolve(tmpdir()) + sep));
  process.env.DB_PATH=join(temp,'test.db');
  const {sqlite,initSchema}=await import('../server/db/index.js');
  const {registerRoutes}=await import('../server/routes.js');
  const app=Fastify();
  try {
    initSchema();
    sqlite.prepare("INSERT INTO books(title,authors,created_at) VALUES ('Сохранить','Автор','2020-01-01')").run();
    const before=sqlite.prepare('SELECT * FROM books').all();initSchema();
    assert.deepEqual(sqlite.prepare('SELECT * FROM books').all(),before);
    await registerRoutes(app);
    const create=await app.inject({method:'POST',url:'/api/books',payload:{title:'Сборник',authors:'Имя Автора',series:'Цикл',seriesOrder:1,seriesEnd:3,status:'read',note:'Не терять'}});
    assert.equal(create.statusCode,201,create.body);const id=create.json().id;
    const put=await app.inject({method:'PUT',url:'/api/series/reference',payload:reference()});assert.equal(put.statusCode,200,put.body);
    assert.equal((await app.inject('/api/series')).json()[0].status,'complete');
    assert.equal((await app.inject('/api/series')).json()[0].following,true);
    const snapshot = sqlite.prepare('SELECT * FROM books').all();
    const stop = await app.inject({method:'PUT',url:'/api/series/preference',payload:{name:'Цикл',following:false}});
    assert.equal(stop.statusCode,200,stop.body);
    initSchema(); // A startup and a reference refresh must retain the user's preference.
    await app.inject({method:'PUT',url:'/api/series/reference',payload:reference()});
    const ignored = (await app.inject('/api/series')).json()[0];
    assert.equal(ignored.following,false); assert.equal(ignored.status,'complete');
    assert.deepEqual(sqlite.prepare('SELECT * FROM books').all(),snapshot);
    assert.equal((sqlite.prepare('SELECT following FROM series_preferences WHERE name=?').get('Цикл') as {following:number}).following,0);
    for (const payload of [{name:'Цикл',following:'false'}, {name:'Цикл'}, {name:'',following:false}]) {
      assert.equal((await app.inject({method:'PUT',url:'/api/series/preference',payload})).statusCode,400);
    }
    assert.equal((await app.inject({method:'PUT',url:'/api/series/preference',payload:{name:'Нет такой',following:false}})).statusCode,404);
    assert.equal((await app.inject('/api/series')).json()[0].following,false);
    assert.equal((await app.inject({method:'PUT',url:'/api/series/preference',payload:{name:'Цикл',following:true}})).statusCode,200);
    assert.equal((await app.inject('/api/series')).json()[0].following,true);
    assert.equal(JSON.parse((sqlite.prepare('SELECT payload FROM series_references').get() as {payload:string}).payload).publication,'finished');
    assert.equal((await app.inject({method:'PUT',url:'/api/series/reference',payload:{...reference(),sources:['javascript:alert(1)']}})).statusCode,400);
    assert.equal((await app.inject({method:'PATCH',url:`/api/books/${id}`,payload:{seriesPart:1}})).statusCode,400);
    const update=await app.inject({method:'PATCH',url:`/api/books/${id}`,payload:{seriesEnd:null,seriesPart:1}});assert.equal(update.statusCode,200,update.body);
    assert.equal(update.json().seriesPart,1);assert.equal(update.json().note,'Не терять');assert.equal(update.json().status,'read');assert.equal(update.json().authors,'Имя Автора');
    assert.equal((await app.inject('/api/series')).json()[0].status,'unknown');
    await app.inject({method:'DELETE',url:`/api/books/${id}`});assert.deepEqual((await app.inject('/api/series')).json(),[]);
    assert.deepEqual(sqlite.pragma('foreign_key_check'),[]);
  } finally {await app.close();sqlite.close();rmSync(temp,{recursive:true,force:true});}
});
