# Wysyłki — instrukcja użytkownika

Zakładka **Wysyłki** prowadzi wysyłki do UK (i innych krajów) dla Acemark i WEM: kto jest importerem, przewoźnik, kierowca i auto, faktury, pozycje z wagami i zdjęciami oraz dokumenty — faktury, skan CMR, podpisana lista pakowa i **CC599** (potwierdzenie wywozu). Listę pakową (po polsku i angielsku) aplikacja tworzy sama. Zastępuje tablicę monday „DostawyUK/Deliveries from PL” i dokumenty z Eledo.

## 1. Jak wejść i kto co widzi

1. Biuro: otwórz **office.acemark.com.pl**, zaloguj się i w górnym menu kliknij **Logistyka ▸ Wysyłki**.
2. Telefon: otwórz aplikację **FitAWindow** i zaloguj się. Magazyn widzi zakładkę **Wysyłki** obok Wydań i Zwrotów, produkcja obok **Czasu pracy**; logistyka i księgowość od razu po zalogowaniu.

| Rola | Co widzi i może |
| --- | --- |
| **Logistyka** | Wszystkie wysyłki w biurze i w telefonie: dodaje, zmienia i usuwa wysyłki, pozycje, zdjęcia i dokumenty, pobiera listę pakową |
| **Księgowość** (Acemark Finance) | To samo co logistyka; dodatkowo pilnuje dokumentów CC599 do VAT 0% |
| **Administrator** | Wszystko |
| **Magazyn**, **Produkcja**, **Kierownik produkcji**, **Lider zmiany** | Tylko telefon: zaznacza załadowane pozycje, wpisuje wagi, robi zdjęcia pozycji, CMR i podpisanej listy pakowej, ustawia „W trakcie” i „Wysłane”. Nie dodaje, nie zmienia i nie usuwa wysyłek ani pozycji |

## 2. Lista wysyłek

![Lista wysyłek](sh1.png)

*Zrzut ekranu z przykładowymi danymi.*

| Element | Co pokazuje |
| --- | --- |
| Kafelki u góry | Ile wysyłek jeszcze nie wysłano, ile **czeka na dokumenty**, ile wysyłek było w tym roku i ich łączna waga brutto |
| Filtry | Spółka (Acemark / WEM), status — w tym **Czekają na dokumenty** — oraz wyszukiwanie po nazwie, importerze, fakturze i komentarzu |
| Kolejność | **Od najnowszych** (domyślnie: data wysyłki, wysyłki bez daty na górze) albo **Od najstarszych**. Wybór zapamiętuje się na tym komputerze |
| Pozycje, Netto kg, Brutto kg | Liczba pozycji i suma wag z pozycji |
| Zdjęcia | Ile zdjęć pozycji jest w wysyłce |
| Dokumenty | Znaczniki: **zielony** — dokument jest; **czerwony** — wysyłka już wyjechała, a dokumentu brak (CMR, CC599); **szary** — jeszcze go nie ma |
| Status | **Nowy** — dopiero przygotowana; **W trakcie** — trwa załadunek; **Wysłane** — wyjechała; **Wysłane — dokumenty do uzupełnienia** — wyjechała, a skan CMR nie jest jeszcze dodany do aplikacji |

Kliknięcie wiersza otwiera wysyłkę.

## 3. Nowa wysyłka krok po kroku

![Wysyłka — dane](sh2.png)

1. Kliknij **+ Nowa wysyłka**.
2. Wybierz **Firmę** (Acemark lub WEM) — sprzedawca i miejsce nadania uzupełnią się same (można je zmienić w **Sprzedawca i miejsce nadania**).
3. Ustaw **Datę wysyłki**.
4. **Importer i jego adres**: wybierz z listy **Wybierz wcześniejszego importera…** — aplikacja wpisze też miejsce przeznaczenia z poprzedniej wysyłki — albo wpisz nazwę, adres i numer VAT.
5. **Faktura / data**: z listy **+ Dodaj fakturę ze Sprzedaży…** wybierz faktury z ostatnich miesięcy; tekst „FL 7/ACE/11/2026 z dnia 10.11.2026” wpisze się sam. Faktury WEM wpisz ręcznie, każdą w osobnej linii.
6. **Przewoźnik**: wybierz z listy **Wybierz przewoźnika…** — kierowca i numer pojazdu z ostatniej wysyłki tego przewoźnika uzupełnią się same; popraw je, jeśli przyjedzie ktoś inny.
7. **Nazwa wysyłki**: gdy pole jest puste, aplikacja podpowiada nazwę „UK + skrót importera + data”, np. „UK PCW 10.11.2026”; możesz wpisać własną.
8. Kliknij **Dodaj wysyłkę**. Teraz pojawią się sekcje **Pozycje** i **Dokumenty**.

**Nowa wysyłka na podstawie tej** kopiuje firmę, importera, adres dostawy, przewoźnika, kierowcę i auto — przydaje się przy kolejnej wysyłce do tego samego klienta.

## 4. Pozycje

![Pozycje wysyłki](sh3.png)

Każda pozycja to: **ilość**, **jednostka** (Szt., kpl., m2…), **opis**, **netto kg**, **brutto kg** i **komentarz** (zwykle numer Z i numer zamówienia).

1. **+ Dodaj pozycję** dodaje pusty wiersz (jednostka i komentarz kopiują się z poprzedniego).
2. **Dodaj z listy produkcyjnej (PDF)…** czyta wydruk produkcyjny — Archimede (WEM) albo CortizoCad (Acemark), ten sam co w Etykietach — i dodaje każdą pozycję z opisem, wymiarem, ilością oraz numerem Z / zamówienia w komentarzu. Wagi uzupełnij ręcznie.
3. Kliknij **Zapisz pozycje**. Nad tabelą widać liczbę pozycji i sumę wag.
4. **Zdjęcia**: po zapisaniu pozycji przy każdej pojawia się **+📷** — wybierz jedno lub kilka zdjęć. Kliknięcie miniatury otwiera zdjęcie, **×** je usuwa. Zdjęcia są zmniejszane przed wysłaniem.
5. **×** na końcu wiersza usuwa pozycję razem z jej zdjęciami (po kliknięciu **Zapisz pozycje**).

Waga brutto nie może być mniejsza niż netto — aplikacja wtedy nie zapisze pozycji.

## 5. Dokumenty

![Dokumenty wysyłki](sh4.png)

| Sekcja | Co tu trafia |
| --- | --- |
| **Listy pakowe (wygenerowane)** | Zapisują się same przy każdym pobraniu listy pakowej — zostaje najnowsza ze zdjęciami i najnowsza bez zdjęć |
| **Faktury** | PDF faktur z tej wysyłki |
| **CMR (skan)** | Skan lub zdjęcie podpisanego CMR |
| **Podpisana lista pakowa** | Skan lub zdjęcie listy pakowej podpisanej przy załadunku / rozładunku |
| **CC599 (potwierdzenie wywozu)** | Komunikat celny potwierdzający wywóz — podstawa do stawki VAT 0% |
| **Inne** | Wszystko pozostałe |

**+ Dodaj plik** przyjmuje PDF i zdjęcia (można kilka naraz). Kliknięcie nazwy otwiera plik, **×** go usuwa.

## 6. Lista pakowa (PDF)

1. Otwórz wysyłkę i kliknij **Lista pakowa PDF** albo **Lista pakowa ze zdjęciami**.
2. Plik pobierze się na komputer i jednocześnie zapisze w wysyłce (**Dokumenty ▸ Listy pakowe (wygenerowane)**).

Lista pakowa ma te same pola co dotychczasowy formularz, z opisami po polsku i angielsku: faktury, sprzedawca, importer, przewoźnik, miejsce nadania i przeznaczenia, kierowca, numer pojazdu, pozycje z wagami i komentarzem (w wersji ze zdjęciami — pierwsze zdjęcie każdej pozycji), sumy wag, uwagi, termin dostawy, miejsca na podpisy oraz część **Rozładunek**. Długa wysyłka przechodzi na kolejne strony; na dole każdej strony jest data utworzenia i numer strony.

## 7. Telefon: załadunek

1. Otwórz **Wysyłki** — na górze są wysyłki jeszcze niewysłane, niżej wysłane w ostatnim tygodniu. Przeciągnij w dół, aby odświeżyć.
2. Stuknij wysyłkę. Widać importera, adres dostawy, kierowcę, auto i licznik **Załadowano x z y**.
3. **Zaczynam załadunek** ustawia status **W trakcie** (biuro widzi to od razu).
4. Przy każdej pozycji stuknij duży kwadrat, gdy jest załadowana (zrobi się zielony), wpisz **netto kg** i **brutto kg** (zapisują się po wyjściu z pola) i zrób zdjęcie: **📷 Zdjęcie** — aparatem, **Z galerii** — gotowe zdjęcia, kilka naraz.
5. W części **Dokumenty** zrób zdjęcie **CMR** i **podpisanej listy pakowej**.
6. Stuknij **Wysłane**. Jeśli nie wszystkie pozycje są zaznaczone, brakuje wag albo zdjęcia CMR, aplikacja o tym przypomni. Jeśli zdjęcia CMR nie ma jeszcze w aplikacji, wysyłka zapisze się jako **Wysłane — dokumenty do uzupełnienia** — wystarczy później dodać skan.

Zdjęcia wysyłają się po kolei w tle — napis „Wysyłanie zdjęć… zostało N” pokazuje, ile jeszcze zostało. W tym czasie można dalej pracować. Jeśli zdjęcie nie wyśle się (brak internetu), aplikacja to zgłosi — zrób je ponownie, gdy będzie zasięg.

## 8. Czekają na dokumenty

Wysyłka, która już wyjechała (status **Wysłane** albo **Wysłane — dokumenty do uzupełnienia**), czeka na dokumenty, dopóki nie ma w niej **CMR** i **CC599**. Na liście te znaczniki są czerwone, a kafelek **Czekają na dokumenty** pokazuje, ile takich wysyłek jest.

1. Na liście wybierz filtr **Czekają na dokumenty**.
2. Otwórz wysyłkę i w **Dokumenty** dodaj brakujący CMR (skan albo zdjęcie z telefonu) lub CC599, gdy przyjdzie z urzędu celnego.
3. Gdy oba dokumenty są, wysyłka znika z tej listy.

Dla księgowości to lista eksportów, do których brakuje potwierdzenia wywozu.

## 9. Najczęstsze pytania

| Pytanie | Odpowiedź |
| --- | --- |
| Nie widzę **+📷** przy pozycji | Najpierw kliknij **Zapisz pozycje** — zdjęcie dodaje się do zapisanej pozycji |
| Nie ma faktury na liście „Dodaj fakturę ze Sprzedaży” | Lista pokazuje faktury Acemark z ostatnich 4 miesięcy z zakładki Sprzedaż. Inną fakturę (np. WEM) wpisz ręcznie |
| Przewoźnik przyjechał innym autem | Popraw kierowcę i numer pojazdu w wysyłce i zapisz — przy następnej wysyłce tego przewoźnika podpowiedzą się nowe dane |
| Gdzie są stare wysyłki z monday? | Wysyłki z 2026 roku zostały przeniesione z pozycjami, zdjęciami i dokumentami. Starsze zostały w monday |
| Magazyn nie może zmienić opisu pozycji | Tak ma być — pozycje i dane wysyłki zmienia biuro; magazyn zaznacza załadunek, wpisuje wagi i robi zdjęcia |
