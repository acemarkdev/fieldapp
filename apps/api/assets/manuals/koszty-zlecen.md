# Koszty zleceń — instrukcja użytkownika

Zakładka **Koszty zleceń** pokazuje wynik każdego zlecenia produkcyjnego: sprzedaż minus wszystkie koszty. Zastępuje arkusz Koszty.

## 1. Jak wejść

1. Otwórz **office.acemark.com.pl** i zaloguj się adresem e-mail i hasłem.
2. W górnym menu kliknij **Fin&Ops**, a potem **Koszty zleceń**.

Dostęp mają role **Acemark Finance** i **Admin**. Księgowość dodaje i poprawia zlecenia oraz pozycje kosztowe. Tylko administrator blokuje i odblokowuje zlecenia, importuje z Excela, zmienia domyślną stawkę robocizny i usuwa wiele zleceń naraz.

Język polski włącza administrator w **Admin ▸ Users**, w kolumnie Language.

## 2. Ekran listy

Każdy wiersz to jedno zlecenie; kliknięcie wiersza otwiera je.

![Lista kosztów zleceń](jc1.png)

*Zrzut ekranu z przykładowymi danymi.*

| Element | Co pokazuje |
| --- | --- |
| Kafelki u góry | Liczba zleceń (w tym zablokowane), sprzedaż, koszt całkowity, zysk lub strata, rentowność — zawsze dla wierszy widocznych po filtrach |
| Filtry | Rok, miesiąc, klient, stan zlecenia oraz pole wyszukiwania po numerze lub kliencie |
| Stan zlecenia | Niezablokowane, Zablokowane, Bez wpisanej sprzedaży, Sprzedaż inna niż w arkuszu, Bez wpisanych kosztów, Ze stratą |
| Kolumny kosztów | Koszt materiału (RW), panele, szkło, inne dodatkowe, malowanie, transport, odprawa celna, godziny pracy i koszt robocizny |
| Kolumny wyniku | Sprzedaż, koszt całkowity, zysk / strata, rentowność |
| Kłódka przy numerze | Zlecenie zablokowane — nie można go zmieniać |
| Wiersz Razem | Suma wszystkich widocznych zleceń |

Pod przyciskami widać domyślną stawkę robocizny (zł za godzinę). Administrator zmienia ją linkiem **zmień**.

## 3. Dodawanie zlecenia i kosztów

**Nowe zlecenie**

1. Kliknij **+ Nowe zlecenie**.
2. Wpisz **Zlecenie** (numer, np. Z.373). Pole podpowiada numery z zakładki Zamówienia — wybierz z listy, jeśli zlecenie już tam jest.
3. Uzupełnij **Klient**, **Miesiąc** i **Rok**, w których zlecenie ma być liczone.
4. Kliknij **Utwórz zlecenie**. Okno zostaje otwarte i pojawia się część z kosztami.

**Pozycje kosztowe**

1. W części **Dodaj pozycję kosztową** wybierz **Rodzaj**: Koszt materiału (RW), Koszty dodatkowe — panele, Szkło, Inne koszty dodatkowe, Malowanie, Transport, Odprawa celna albo Robocizna.
2. Wpisz **Kwotę**. Dla Robocizny wpisz **Godziny** i **Stawkę** — kwota liczy się sama (godziny × stawka).
3. Opcjonalnie dodaj **Nr faktury**, **Dostawcę**, **Datę** i **Uwagi**.
4. Kliknij **Dodaj pozycję**. Jedno zlecenie może mieć wiele pozycji tego samego rodzaju, np. kilka faktur za transport.

![Okno zlecenia z pozycjami kosztowymi](jc2.png)

*Zrzut ekranu z przykładowymi danymi.*

Pozycję poprawiasz linkiem **edytuj**, usuwasz linkiem **usuń**. Część **Podsumowanie** od razu pokazuje sprzedaż, koszt całkowity, zysk / stratę i rentowność.

## 4. Sprzedaż, blokada, import, eksport

**Skąd bierze się sprzedaż zlecenia.** Jeśli zlecenie ma faktury w zakładce **Sprzedaż**, sprzedaż jest ich sumą netto, a pole w oknie zlecenia jest wyszarzone. Link **Sprzedaż** pod polem przenosi do tych faktur. Jeśli faktur nie ma, kwotę sprzedaży wpisuje się ręcznie.

**Blokada (tylko administrator).** Przycisk **Zablokuj zlecenie** zamyka zlecenie: nikt nie zmieni ani danych, ani kosztów, a sprzedaż zostaje zamrożona w kwocie z chwili blokady. Faktury dodane później nie zmienią wyniku zablokowanego zlecenia. **Odblokuj** przywraca edycję.

**Import z Excela (tylko administrator).**

1. Kliknij **Import z Excela**.
2. W arkuszu **Koszty** zaznacz wiersze zleceń od kolumny **A (LP.)** do kolumny **U (klient)** i skopiuj.
3. Wklej w oknie importu i potwierdź.

Każdy wiersz staje się zleceniem z jedną pozycją kosztową na każdą wypełnioną kolumnę. Zlecenia, które już istnieją, są pomijane, więc można wkleić arkusz ponownie.

**Eksport CSV** zapisuje do pliku to, co jest widoczne po filtrach.

**Usuwanie wielu zleceń (tylko administrator).** Zaznacz zlecenia polami wyboru i kliknij **Usuń zaznaczone**. Bez zaznaczenia przycisk brzmi **Usuń wszystkie widoczne** i usuwa wszystko, co pokazują filtry. Trzeba potwierdzić, wpisując liczbę rekordów. Operacji nie można cofnąć — wcześniej zrób eksport CSV.

## 5. Najczęstsze pytania

- **Nie mogę zmienić zlecenia.** Jest zablokowane (kłódka). Poproś administratora o odblokowanie.
- **Pole Sprzedaż jest wyszarzone.** Zlecenie ma faktury w zakładce Sprzedaż; kwotę zmienia się tam, poprawiając faktury.
- **Sprzedaż wynosi zero, choć faktura jest wystawiona.** Faktura ma w polu Zlecenie inny numer niż to zlecenie. Popraw numer na fakturze w zakładce Sprzedaż.
- **Robocizna pokazuje inną kwotę niż wpisałem.** Dla robocizny liczy się godziny × stawka; sprawdź oba pola.
- **Gdzie widać te koszty dalej?** Koszt materiału (RW) zleceń z danego miesiąca trafia do wiersza Materiały w zakładce **Wyniki**.
