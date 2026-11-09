# Zamówienia i prowizja — instrukcja użytkownika

Zakładka **Zamówienia** to rejestr handlowca: każda wysłana oferta i jej dalszy los. Zakładka **Prowizja** liczy z niego prowizję miesięczną i pokazuje bonus roczny. Razem zastępują skoroszyt „wszystkie zlecenia”.

## 1. Jak wejść i kto co widzi

1. Otwórz **office.acemark.com.pl** i zaloguj się adresem e-mail i hasłem.
2. W górnym menu kliknij **Fin&Ops**, a potem **Zamówienia** albo **Prowizja**.

| Rola | Co widzi i może |
| --- | --- |
| **Handlowiec** (Sales rep) | Tylko te dwie zakładki. Widzi i zmienia **wszystkie** zamówienia (handlowcy pracują razem — np. ktoś wpisuje zamówienia za innego handlowca). Dodaje oferty, zmienia status i dane, wybiera **głównego handlowca**, widzi faktury i wpłaty. Usuwa zamówienie, dopóki nie ma na nim wpłat. Strona Prowizja pokazuje mu tylko jego własną prowizję |
| **Księgowość** (Acemark Finance) | Zamówienia wszystkich handlowców. Dodatkowo: numer Z, wpłaty gotówkowe, numery faktur, data liczenia do prowizji, przypisanie handlowca, import z Excela |
| **Administrator** | To samo co księgowość oraz usuwanie wielu zamówień naraz |

## 2. Ekran listy zamówień

Każdy wiersz to jedna oferta lub zamówienie; kliknięcie wiersza otwiera je.

![Lista zamówień](o1.png)

*Zrzut ekranu z przykładowymi danymi, widok księgowości.*

| Element | Co pokazuje |
| --- | --- |
| Kafelki u góry | Wartość i liczba: ofert do akceptacji, zaakceptowanych, liczonych do prowizji oraz czekających na pierwszą wpłatę |
| Filtry | Rok i miesiąc wysłania oferty, status, opłacone lub nie, firma, handlowiec oraz pole wyszukiwania |
| Kolejność | **Od najnowszych** (domyślnie: miesiąc wysłania oferty, potem data dodania) albo **Od najstarszych**. Wybór zapamiętuje się na tym komputerze |
| Status | **Oferta** — wysłana, czeka na decyzję; **Zaakceptowane** — klient potwierdził; **Utracone** — klient zrezygnował |
| Netto, Koszty, Marża | Wartość netto zamówienia, suma kosztów (zakup, montaż, dostawa) i marża w procentach |
| Wpłacono | Suma faktur i wpłat gotówkowych zarejestrowanych na zamówieniu |
| Liczone od | Dzień pierwszej wpłaty. „jeszcze nie opłacone” = zaakceptowane, ale bez wpłaty, więc jeszcze poza prowizją |
| Fioletowy znaczek z numerem Z | Zamówienie ma już zlecenie produkcyjne w Orpiszewie |

## 3. Handlowiec: nowa oferta i zmiana statusu

**Nowa oferta**

1. Kliknij **+ Nowe zamówienie**.
2. Wpisz **Numer / nazwę zamówienia** — tak jak w ofercie, np. „OK DE203171 -Essen- Familie Krüger”. Dla zlecenia produkowanego w Orpiszewie może to być od razu numer Z.
3. Uzupełnij **Klienta**, **Firmę** (Acemark / WEM), **Dostawcę**, **Materiał** i **Wartość netto**.
4. Sprawdź miesiąc wysłania oferty i miesiąc zapytania (domyślnie bieżący).
5. Jeśli znasz koszty, wpisz **Koszt zakupu**, **montażu** i **dostawy** — marża policzy się sama.
6. **Handlowiec (główny)**: domyślnie Ty. Jeśli wpisujesz zamówienie za innego handlowca, wybierz jego — wtedy zamówienie liczy się do jego prowizji. Przy zamówieniu bez handlowca pole pokazuje „(bez handlowca)” i zapis go nie zmienia.
7. Kliknij **Dodaj zamówienie**. Status nowej pozycji to **Oferta**.

**Zapisz, nie zamykaj** zapisuje wpisane dane i zostawia okno otwarte — przydaje się przy dłuższym wpisywaniu. Zamknięcie okna z niezapisanymi zmianami (×, Esc albo kliknięcie obok okna) najpierw pyta: „Masz niezapisane zmiany. Odrzucić je?”.

![Okno nowego zamówienia — widok handlowca](o3.png)

*Zrzut ekranu z przykładowymi danymi.*

**Gdy klient odpowie**

1. Otwórz zamówienie kliknięciem wiersza.
2. Zmień **Status** na **Zaakceptowane** albo **Utracone**.
3. Jeśli zmieniła się kwota, popraw **Wartość netto**; możesz też podać **Planowaną realizację**.
4. Kliknij **Zapisz zamówienie**.

Do prowizji liczy się tylko zamówienie **zaakceptowane**, i dopiero od miesiąca pierwszej wpłaty. Wpłaty rejestruje księgowość — zobaczysz je w dolnej części okna zamówienia.

## 4. Oferty dla klienta

W oknie zamówienia, w części **Oferty dla klienta**, zapisuje się każdą ofertę wysłaną klientowi: cenę, zakres, plik i budżet. Gdy zamówienie ma oferty, to one ustalają wartość netto, budżet i status zamówienia.

![Oferty dla klienta](o5.png)

*Zrzut ekranu z przykładowymi danymi: dwie zatwierdzone oferty sumują się w wartość zamówienia.*

**Nowa oferta**

1. Kliknij **+ Oferta v1** (kolejne: **+ Oferta v2**, **v3**…). Formularz podpowiada ceny i koszty z najnowszej oferty.
2. Wpisz cenę dla klienta w częściach: **Produkty (zł netto)**, **Montaż dla klienta** i **Transport dla klienta**. **Kwota oferty dla klienta** to ich suma i liczy się sama.
3. Wybierz **Zakres**: **Dostawa i montaż**, **Tylko dostawa** (montaż się nie liczy) albo **Odbiór własny** (nie liczy się ani montaż, ani transport).
4. Wpisz budżet: **Koszt zakupu**, **montażu** i **dostawy** — obok widać koszt całkowity i marżę.
5. Dołącz **plik oferty wysłany klientowi**, wybierz status i kliknij **Zapisz ofertę**.

**Status oferty**

| Status | Znaczenie |
| --- | --- |
| **Wysłana** | Klient ją dostał, czeka na decyzję |
| **Zatwierdzona** | Klient ją przyjął — zamówienie staje się **Zaakceptowane** |
| **Odrzucone** | Klient jej nie przyjął; gdy odrzucona jest najnowsza, a żadna nie jest zatwierdzona, zamówienie jest **Utracone** |
| **Do poprawy** | Trzeba przygotować nową wersję |

Status zmienia się z listy w wierszu oferty.

**Kilka zatwierdzonych ofert**

Zamówienie może mieć kilka zatwierdzonych ofert — np. okna w jednej ofercie, rolety w drugiej. Wtedy:

- **wartość netto zamówienia** to suma zatwierdzonych ofert, tak samo budżet (zakup, montaż, dostawa),
- każda zatwierdzona oferta ma znacznik **liczy się**, a pod tabelą widać sumę, np. „2 zatwierdzone oferty: 129 194,59 zł netto — wartość zamówienia”,
- w oknie zamówienia przy wartości netto jest napis „suma 2 zatwierdzonych ofert”.

Dopóki żadna oferta nie jest zatwierdzona, liczy się najnowsza.

**Edycja oferty**

![Edycja oferty](o6.png)

1. Kliknij **edytuj** pod numerem wersji.
2. Popraw ceny, zakres, budżet lub komentarz; możesz też dołączyć nowy plik (stary zostanie zastąpiony).
3. Kliknij **Zapisz zmiany**. Numer wersji zostaje ten sam, a wartość i budżet zamówienia przeliczają się od razu.

Najnowszą ofertę, która nie jest zatwierdzona, można usunąć (**usuń**).

## 5. Księgowość: wpłaty, numer Z, data liczenia

Po otwarciu zamówienia księgowość widzi dodatkową część **Księgowość** oraz **Faktury i wpłaty**.

![Okno zamówienia — widok księgowości](o2.png)

*Zrzut ekranu z przykładowymi danymi.*

**Faktura (zaliczkowa lub końcowa)**

1. W oknie zamówienia kliknij **+ Faktura (zakładka Sprzedaż)**.
2. Otworzy się formularz faktury z wpisanym już numerem zlecenia i nabywcą. Uzupełnij numer faktury, rodzaj, datę i kwoty.
3. Kliknij **Dodaj fakturę**. Faktura pojawi się na zamówieniu sama.

Fakturę można też dodać wprost w zakładce Sprzedaż — wystarczy, że w polu Zlecenie będzie numer tego zamówienia.

**Wpłata gotówkowa**

1. Na dole okna wpisz **datę wpłaty**, **kwotę** i ewentualnie uwagę.
2. Kliknij **+ Wpłata gotówkowa**.

Wpłata gotówkowa ustawia miesiąc prowizji i wlicza się do „Wpłacono”. Nie dodaje się do sprzedaży w Wynikach ani w Kosztach zleceń.

**Pola księgowości**

| Pole | Do czego służy |
| --- | --- |
| **Handlowiec** | Czyje to zamówienie — od tego zależy, kto je widzi i czyja to prowizja |
| **Zlecenie produkcyjne w Orpiszewie (numer Z)** | Wpisz Z.xxx, gdy zamówienie OK trafia do produkcji. Zamówienie zachowuje oba numery; faktury pod każdym z nich należą do niego |
| **Numery faktur** | Jeśli faktura ma w Sprzedaży inny numer zlecenia, wpisz tu jej numer — też zostanie powiązana |
| **Liczone do prowizji od** | Zwykle puste: liczy się pierwsza faktura lub wpłata. Wpisz datę tylko wtedy, gdy zamówienie ma być policzone w innym miesiącu |

Pod listą faktur i wpłat okno zawsze pisze, w którym miesiącu zamówienie liczy się do prowizji i skąd wzięła się ta data.

## 6. Prowizja

Strona pokazuje wybrany rok: bieżący miesiąc u góry, wszystkie miesiące w tabeli, bonus roczny na dole. Księgowość wybiera handlowca z listy; handlowiec widzi tylko siebie.

![Strona prowizji — widok handlowca](c1.png)

*Zrzut ekranu z przykładowymi danymi.*

**Jak liczona jest prowizja miesięczna**

Suma miesiąca to pełna wartość netto zaakceptowanych zamówień, których pierwsza wpłata została zaksięgowana w tym miesiącu. Osiągnięty próg wyznacza stawkę dla całego miesiąca.

| Sprzedaż netto w miesiącu | Stawka | Przykład |
| --- | --- | --- |
| poniżej 300 000 zł | 0% | — |
| od 300 000 do 450 000 zł | 1% | 300 000 zł → 3 000 zł |
| powyżej 450 000 do 600 000 zł | 1,5% | 600 000 zł → 9 000 zł |
| powyżej 600 000 zł | 2% | 1 000 000 zł → 20 000 zł |

**Jak czytać stronę**

- **Górna karta:** sprzedaż liczona w bieżącym miesiącu, prowizja i ile brakuje do następnego progu. Pasek pokazuje trzy progi.
- **Pod paskiem:** zamówienia zaakceptowane, które czekają na pierwszą wpłatę (policzą się w miesiącu wpłaty), oraz otwarte oferty.
- **Tabela:** dla każdego miesiąca liczba zamówień, sprzedaż liczona, stawka, prowizja i ile brakuje do 1%, 1,5% i 2%. Znak ✓ oznacza próg osiągnięty.
- **Kliknięcie miesiąca** rozwija listę zamówień, które się na niego składają, z datą pierwszej wpłaty.

**Bonus roczny**

Zależy od własnej sprzedaży handlowca w roku kalendarzowym: pełnej wartości netto zaakceptowanych zamówień, w których jest **głównym handlowcem**, liczonej w miesiącu pierwszej wpłaty — ale dopiero gdy zamówienie ma **co najmniej jedną fakturę**. Zamówienie WEM (fakturowane z Subiekta WEM, bez faktury Acemark) liczy się od daty wpłaty. Zamówienia bez handlowca i zamówienia innych handlowców się nie liczą. Strona pokazuje osiągnięty próg i ile sprzedaży brakuje do następnego. Obrót firmy (faktury z zakładki Sprzedaż, bez refaktur) jest pod spodem tylko informacyjnie.

| Sprzedaż handlowca w roku | Maksymalny bonus |
| --- | --- |
| od 3,6 mln zł do 5 mln zł | do 5% rocznego wynagrodzenia brutto |
| powyżej 5 mln zł do 10 mln zł | do 10% |
| powyżej 10 mln zł | do 15% |

Faktyczną wysokość bonusu ustala Zarząd; wypłata następuje do 31 marca kolejnego roku. Prowizja miesięczna jest wypłacana po zaksięgowaniu płatności od klienta.

## 7. Zgłoszenia kosztów od monterów

Dodatkowe koszty montażu (dieta, dodatek za montaż, nocleg, dojazd) zgłasza monter, a do kosztów zamówienia trafiają dopiero po akceptacji i wypłacie.

| Krok | Kto | Co robi |
| --- | --- | --- |
| 1. Zgłoszenie | Monter | W zakładce **Koszty montażu** wybiera zamówienie, rodzaj kosztu i kwotę w PLN. Data zapisuje się sama. Widzi tylko numer zamówienia i klienta oraz własne zgłoszenia |
| 2. Akceptacja | Handlowiec zamówienia | W zakładce Zamówienia klika **Zgłoszenia kosztów** i wybiera **Akceptuj** albo **Odrzuć** (z powodem, który zobaczy monter) |
| 3. Wypłata | Księgowość | Na tej samej liście klika **Oznacz jako wypłacone** przy zaakceptowanym zgłoszeniu |

Przycisk **Zgłoszenia kosztów** pokazuje, ile pozycji czeka na Ciebie. Te same zgłoszenia widać też na dole okna zamówienia.

- **Koszt montażu zamówienia** = kwota wpisana w polu Koszt montażu + zgłoszenia **wypłacone**. Zgłoszenia czekające i zaakceptowane nie zmieniają jeszcze kosztów ani marży.
- Monter może wycofać zgłoszenie, dopóki czeka na akceptację.
- Zamówienie bez przypisanego handlowca akceptuje księgowość. Administrator może wykonać każdy krok.
- Księgowość może cofnąć wypłatę albo odrzucić zaakceptowane zgłoszenie (z powodem).

## 8. Import z Excela i najczęstsze pytania

**Import z Excela (księgowość i administrator)**

1. Kliknij **Import z Excela**.
2. Wybierz handlowca, do którego należą zamówienia, i rok dla wierszy z pustą kolumną Rok.
3. W skoroszycie otwórz arkusz **TomaszProwizja**, zaznacz wiersze od kolumny **A (Lp)** do **W (Rok)**, skopiuj i wklej.
4. Kliknij **Sprawdź**. Okno pokaże, ile zamówień zostanie dodanych, ile pominiętych, oraz porównanie z zakładką Sprzedaż.
5. Jeśli wynik się zgadza, kliknij **Importuj**.

![Okno importu po sprawdzeniu](o4.png)

*Zrzut ekranu z przykładowymi danymi.*

Wiersze, które już są w rejestrze, są pomijane, więc można wkleić cały arkusz ponownie.

**Najczęstsze pytania**

- **Zamówienie jest zaakceptowane, a nie liczy się do prowizji.** Nie ma jeszcze wpłaty. Policzy się w miesiącu, w którym księgowość zarejestruje pierwszą fakturę lub wpłatę.
- **Faktura jest wystawiona, a zamówienie nadal „jeszcze nie opłacone”.** Faktura ma w Sprzedaży inny numer zlecenia. Księgowość poprawia numer na fakturze albo wpisuje numer faktury w polu Numery faktur na zamówieniu.
- **Klient wpłacił tylko zaliczkę — ile się liczy?** Pełna wartość netto zamówienia, w miesiącu zaliczki.
- **Oferta została wysłana ponownie z nową ceną.** Dodaj nową wersję oferty (**+ Oferta v2**) albo popraw ofertę przyciskiem **edytuj**; nie dodawaj drugiego zamówienia z tym samym numerem.
- **Klient przyjął dwie oferty (np. okna i rolety).** Zatwierdź obie — wartość zamówienia to ich suma.
- **Nie mogę usunąć swojego zamówienia.** Są na nim wpłaty. Poproś księgowość.
- **Okno zamówienia zamknęło się podczas pisania.** Używaj **Zapisz, nie zamykaj** przy dłuższym wpisywaniu; zamknięcie z niezapisanymi zmianami zawsze pyta o potwierdzenie.
- **Jak pobrać listę?** **Eksport CSV** zapisuje to, co jest widoczne po filtrach.
