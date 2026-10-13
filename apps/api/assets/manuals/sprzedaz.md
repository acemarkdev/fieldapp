# Sprzedaż — instrukcja użytkownika

Zakładka **Sprzedaż** to rejestr faktur sprzedaży: jedna pozycja na fakturę, pokazywane razem w ramach zlecenia. Zastępuje arkusz Sprzedaż.

## 1. Jak wejść

1. Otwórz **office.acemark.com.pl** i zaloguj się adresem e-mail i hasłem.
2. W górnym menu kliknij **Fin&Ops**, a potem **Sprzedaż**.

Dostęp mają role **Acemark Finance** i **Admin**. Księgowość dodaje, poprawia i usuwa pojedyncze faktury. Tylko administrator importuje z Excela i usuwa wiele faktur naraz.

To, co tu wpiszesz, zasila trzy inne miejsca: sprzedaż zlecenia w **Kosztach zleceń**, wiersze sprzedaży w **Wynikach** oraz wpłaty i prowizję w **Zamówieniach**.

## 2. Ekran listy

Każdy wiersz to jedno **zlecenie** ze wszystkimi jego fakturami. Kliknięcie wiersza rozwija faktury.

![Lista sprzedaży z rozwiniętym zleceniem](s1.png)

*Zrzut ekranu z przykładowymi danymi.*

| Element | Co pokazuje |
| --- | --- |
| Kafelki u góry | Liczba zleceń i faktur, razem netto, osobno Sprzedaż z Orpiszewa i Handel z Polski — dla wierszy widocznych po filtrach |
| Filtry | Rok, miesiąc, źródło (Orpiszew / handel), kraj, nabywca, stan oraz pole wyszukiwania |
| Stan | Zlecenia z kilkoma fakturami, Z zaliczką, Planowane (bez numeru faktury), Bez zlecenia, Powiązane z zamówieniem, Bez powiązania z zamówieniem |
| Kolumny | Zlecenie, nabywca, kraj, źródło, liczba faktur, zaliczki netto, końcowe netto, razem netto, razem brutto, okres |
| Znaczek „zamówienie” | Zlecenie jest w rejestrze handlowca (zakładka Zamówienia) |
| Rozwinięte faktury | Numer i data, rodzaj (Zaliczka / Końcowa), kwoty oraz linki **edytuj** i **usuń** |

Zakładka otwiera się z filtrem ustawionym na najnowszy rok. Aby zobaczyć wszystko, wybierz **Wszystkie lata**.

## 3. Dodawanie faktury

1. Kliknij **+ Dodaj fakturę**.
2. Wypełnij formularz według tabeli poniżej.
3. Kliknij **Dodaj fakturę**.

![Formularz faktury sprzedaży](s2.png)

*Zrzut ekranu z przykładowymi danymi.*

| Pole | Co wpisać |
| --- | --- |
| **Zlecenie** | Numer zlecenia: Z.xxx dla produkcji w Orpiszewie albo numer OK dla handlu. Pole podpowiada numery z zakładki Zamówienia — najlepiej wybrać z listy. Puste, jeśli faktura nie dotyczy zlecenia |
| **Nr faktury** | Numer faktury. Puste oznacza fakturę planowaną, jeszcze niewystawioną |
| **Rodzaj** | Faktura końcowa albo Zaliczka |
| **Data faktury** | Data wystawienia |
| **Netto (zł)** | Kwota netto — pole wymagane |
| **Brutto (zł)** | Kwota brutto |
| **Nabywca**, **Kraj** | Klient i kraj (UK, DE, PL, ES, NL) |
| **Producent** | Acemark PL = produkcja w Orpiszewie; każdy inny (np. Eko-okna) = Handel z Polski |
| **Sprzedawca** | Spółka wystawiająca fakturę |
| **Liczona w miesiącu**, **Rok** | Zostaw „(z daty)”, jeśli faktura ma być liczona w miesiącu wystawienia; zmień tylko wtedy, gdy ma trafić do innego okresu |
| **Uwagi** | Dowolna notatka |

**Podpowiedź pod polem Zlecenie** mówi od razu, czy numer należy do zamówienia:

- zielony napis **Zamówienie: …** — faktura zostanie pokazana jako wpłata na tym zamówieniu i policzy się do prowizji;
- pomarańczowe ostrzeżenie — żadne zamówienie nie ma tego numeru. Faktura zapisze się normalnie, ale nie będzie widoczna na żadnym zamówieniu. Sprawdź numer.

Spacje, myślniki i wielkość liter nie mają znaczenia: „OK DE 203065” i „ok-de203065” to ten sam numer.

## 4. Poprawianie, usuwanie, import, eksport

**Poprawianie i usuwanie jednej faktury.** Rozwiń zlecenie kliknięciem wiersza, a przy fakturze kliknij **edytuj** albo **usuń**.

**Import z Excela (tylko administrator).**

1. Kliknij **Import z Excela**.
2. W arkuszu **Sprzedaż** zaznacz wiersze faktur od kolumny **A (Data wystawienia)** do kolumny **L (Sprzedawca)** i skopiuj.
3. Wklej w oknie importu i potwierdź.

Pozycje, które już są (ten sam numer faktury, zlecenie i kwota netto), są pomijane, więc można wkleić arkusz ponownie.

**Eksport CSV** zapisuje do pliku to, co jest widoczne po filtrach.

**Usuwanie wielu faktur (tylko administrator).** Pole wyboru przy zleceniu zaznacza wszystkie jego faktury; po rozwinięciu można zaznaczyć pojedyncze. Kliknij **Usuń zaznaczone**. Bez zaznaczenia przycisk brzmi **Usuń wszystkie widoczne** i usuwa wszystko, co pokazują filtry — przy domyślnym filtrze tylko najnowszy rok. Trzeba potwierdzić, wpisując liczbę faktur. Operacji nie można cofnąć — wcześniej zrób eksport CSV.

## 5. Najczęstsze pytania

- **Zaliczka i faktura końcowa — jak je wpisać?** Jako dwie osobne faktury z tym samym numerem zlecenia: pierwsza z rodzajem Zaliczka, druga jako Faktura końcowa. Lista pokaże je razem.
- **Faktura nie pojawia się na zamówieniu handlowca.** Numer w polu Zlecenie nie zgadza się z numerem zamówienia. Użyj filtra **Bez powiązania z zamówieniem**, znajdź fakturę i popraw numer.
- **Zlecenie przeszło z numeru OK na numer Z.** Na fakturze można zostawić dowolny z nich — księgowość dopisuje numer Z na zamówieniu i oba numery prowadzą do tego samego zamówienia.
- **Do którego miesiąca liczy się faktura?** Do miesiąca z daty faktury, chyba że w polach Liczona w miesiącu / Rok wskazano inny.
- **Co oznacza „planowana”?** Pozycja bez numeru faktury — kwota oczekiwana, jeszcze niewystawiona.
