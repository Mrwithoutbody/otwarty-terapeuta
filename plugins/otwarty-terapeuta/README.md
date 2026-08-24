# Otwarty Terapeuta — plugin

Pakiet pluginu dla ChatGPT i Codex, oparty na produkcyjnym serwerze MCP:

`https://mcp.otwartyterapeuta.pl/mcp`

Publiczne narzędzia katalogowe działają anonimowo. OAuth jest uruchamiany dopiero
przez narzędzia rezerwacji, które wymagają zakresu `booking:read` albo
`booking:write`.

Pakiet używa `.app.json`, który wskazuje zarejestrowane w ChatGPT połączenie
Developer Mode — identyfikator jest w tym pliku i nigdzie indziej. Polityka
marketplace musi mieć `authentication: "ON_USE"`, aby instalacja pluginu nie
uruchamiała logowania. Sam serwer rozdziela dostęp per narzędzie: katalog ma
`noauth`, a operacje rezerwacyjne `oauth2`.

Publiczne zgłoszenie należy utworzyć w OpenAI Platform jako **With MCP →
Universal** i podać bezpośrednio produkcyjny URL MCP. Instalacja, rozmowa,
wyszukiwanie, profile, FAQ i sprawdzanie terminów nie wymagają logowania. OAuth
może zostać uruchomiony dopiero przez `preview_booking`, gdy użytkownik wybierze
termin i zdecyduje, że chce go zarezerwować.
