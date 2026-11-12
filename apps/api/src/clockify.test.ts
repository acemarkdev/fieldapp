// Production time ▸ Clockify import: reading the "Wpisy" sheet, the job of a task, matching the workers, Polish time.
import { parseClockify, jobOfTask, matchWorker, polishInstant, dayOf, timeOf, nameKey } from './clockify';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (cond) console.log('✓ ' + name); else { fail++; console.log('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };

// rows as the "Wpisy" sheet of "Clockify 2026-11-12.xlsx" has them
const rows = [
  ['Data', 'Osoba', 'Start', 'Koniec', 'Czas', 'Czas [h]', 'Projekt', 'Zadanie', 'Opis'],
  ['12.11.2026', 'G.kozlowski', '6:00', '6:54', '0:53', '0.90', 'Produkcja', 'Z_434_pakowanie', ''],
  ['12.11.2026', 'G.kozlowski', '6:54', '9:00', '2:05', '2.09', 'Produkcja', 'Z_439_skrecanie_cor_vision_Poz_1_cor_vision_021_w1', ''],
  ['12.11.2026', 'G.kozlowski', '10:37', '11:03', '0:26', '0.44', 'Produkcja', 'Poza planem - Wyjazd', 'Dino'],
  ['12.11.2026', 'Kamilteodorczyk', '6:00', '7:40', '1:40', '1.67', 'Produkcja', 'Z_444_cnc_Poz_1,2,3,4,5,6,7,8,9,10,12,11,14_mt_50_000_w0', ''],
  ['', '', '', '', '', '', '', '', ''],
  ['12.11.2026', 'lukasznowicki', '9:30', '', '2:08', '2.14', 'Produkcja', 'Poza planem', 'Z.458 rezerwacja zlecenia'],
];
const p = parseClockify(rows);
ok('rows read, the header and an empty row skipped, a row without an end counted', p.rows.length === 4 && p.skipped === 1 && p.days.join() === '2026-11-12', p);
ok('the job from the task; "Poza planem" has none', p.rows[0].job_ref === 'Z.434' && p.rows[1].job_ref === 'Z.439' && p.rows[2].job_ref === null && p.rows[3].job_ref === 'Z.444', p.rows.map((r) => r.job_ref));
ok('the description is kept as the note', p.rows[2].note === 'Dino');
ok('job of a task: Z_439_… / Z.439 / z 439; not Z.4390 from Z_4390', jobOfTask('Z_439_szklenie') === 'Z.439' && jobOfTask('Z.439 cnc') === 'Z.439' && jobOfTask('z 439') === 'Z.439' && jobOfTask('Z_4390_x') === 'Z.4390' && jobOfTask('Poza planem - Awaria CNC') === null);
ok('dates and times: dd.mm.yyyy, ISO, Excel numbers', dayOf('12.11.2026') === '2026-11-12' && dayOf('2026-11-12') === '2026-11-12' && dayOf(46338) === '2026-11-12' && timeOf('6:00') === '06:00' && timeOf('13:59:00') === '13:59' && timeOf(0.25) === '06:00' && timeOf('25:00') === null);
ok('Polish time: winter +1, summer +2', polishInstant('2026-11-12', '06:00') === '2026-11-12T05:00:00.000Z' && polishInstant('2026-07-01', '06:00') === '2026-07-01T04:00:00.000Z');
const users = [{ id: '1', name: 'Kamil Teodorczyk', email: 'kamil@x.pl' }, { id: '2', name: 'Grzegorz Kozłowski', email: null }, { id: '3', name: 'Robert Kozłowski', email: 'rkozlowski@x.pl' }, { id: '4', name: 'Łukasz Nowicki', email: null }];
ok('workers: whole name, initial + surname, e-mail', matchWorker('Kamilteodorczyk', users)?.id === '1' && matchWorker('G.kozlowski', users)?.id === '2' && matchWorker('rkozlowski', users)?.id === '3' && matchWorker('lukasznowicki', users)?.id === '4');
ok('an unknown worker is not guessed', matchWorker('Sebastianskorek', users) === null && nameKey('Łukasz Nowicki') === 'lukasznowicki');

if (fail) { console.error(`\n${fail} FAIL`); process.exit(1); }
console.log('All Clockify tests passed.');
