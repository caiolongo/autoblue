# AutoBlue — plano

Espaço livre para montar circuitos e sistemas embarcados, ver de onde a energia vem e testar tudo num simulador. Sem lições prontas, sem CLI e sem gravar placas: o objetivo é entender como o hardware funciona.

## Princípios

1. **Livre.** Nada de trilhas ou desafios. Você monta o que quiser.
2. **Fios em qualquer lugar.** Pino com pino, fio no meio de outro fio, qualquer ponto. O editor nunca bloqueia uma ligação, mesmo que ela cause curto-circuito.
3. **Consequências reais.** Curto, sobrecorrente e tensão demais são simulados: o componente esquenta, queima ou o fusível abre. `Cmd+Z` desfaz.
4. **O que está escrito nas placas.** Serigrafia (`5V`, `GND`, `VIN`, `D13`), códigos dos chips (`ATMEGA328P`, `AMS1117-3.3`), faixas de cores dos resistores, polaridade de capacitores e LEDs. Passe o mouse sobre qualquer texto para ver o que ele significa.
5. **Explicação na hora.** O inspetor "Por quê?" mostra a conta com os números reais e o caminho da energia: *USB → regulador → linha de 5V → resistor → LED*.
6. **Hardware aberto.** Chips podem ser abertos para ver o circuito interno: driver push-pull do pino, pull-up interno, registradores, clock.

## Stack

| Camada | Escolha |
|---|---|
| App | Tauri 2 |
| Interface | React + TypeScript + Vite, Zustand |
| Canvas | SVG próprio (grade de 0,1", fios livres, junções em qualquer ponto) |
| Simulador | Crate Rust próprio: Análise Nodal Modificada (MNA), Newton-Raphson para não lineares, Euler/trapezoidal para transiente |
| Projetos | Arquivo `.abp` (JSON versionado com serde) |

### O simulador nunca falha

Como qualquer ligação é permitida, o simulador precisa sempre responder com algo físico:

- Fontes têm resistência interna (pilha ≈ 0,1–0,5 Ω, USB com polyfuse de 500 mA).
- Fios têm resistência pequena, mas não zero.
- Cada nó tem uma condutância mínima (gmin), para que pontos soltos não deixem a matriz singular.
- Cada componente tem limites máximos (corrente, tensão, potência). Passou do limite: estado `danificado`, e o componente vira circuito aberto ou curto, conforme o tipo.

## Cores

Tokens tirados do blueprint.page, em [src/ui/tokens.css](../src/ui/tokens.css).

| Token | Claro | Escuro |
|---|---|---|
| `--brand` | `#104BFF` | `#104BFF` |
| `--brand-2` | `#4976FF` | `#4976FF` |
| `--shell-bg` | `#EEEFF1` | `#09090A` |
| `--bg` | `#F7F7F8` | `#0C0C0D` |
| `--panel` | `#FFFFFF` | `#131314` |
| `--line` | `#E4E4E7` | `#242427` |
| `--text` | `#18181B` | `#EDEDEF` |
| `--muted` | `#5F5F68` | `#8A8A92` |

Cores elétricas: VCC `#FF4A2B`, 3V3 `--brand-2`, GND `--line-strong`, sinal `--brand`, aviso `#F4C80F`.

Fontes: Geist Sans (interface) e Geist Mono (valores, nets, serigrafia).

## Fases

| # | Fase | Entregável |
|---|---|---|
| 0 | Fundação | Tauri + React, tokens, layout com painéis, canvas com grade, zoom e pan, tema claro/escuro |
| 1 | Editor livre | Componentes com serigrafia e marcações reais; fios livres e junções; girar e espelhar; desfazer; salvar e abrir `.abp`; netlist |
| 2 | Simulação DC ao vivo + energia | Fios coloridos por tensão, partículas de corrente, árvore de alimentação, consumo, curto e queima, inspetor "Por quê?" |
| 3 | Transiente + instrumentos | Capacitores, indutores, transistores, botões, fusíveis, reguladores; multímetro e osciloscópio livres; pausar, câmera lenta e passo a passo |
| 4 | Lógica digital do zero | Portas de transistores, flip-flops, contadores, NE555 |
| 5 | Microcontrolador por dentro | ATmega328P aberto: pinos com circuito interno, registradores clicáveis (DDR/PORT/PIN), sequência visual de passos, alimentação e clock. O motor de MCU é genérico e descrito por dados, para receber os chips da fase 6 |
| 6 | Mais microcontroladores | ATtiny85, RP2040, ESP32, STM32F103 e PIC16F628A, cada um com o que tem de diferente (ver abaixo), mais as peças de apoio que eles exigem |
| 7 | Seus componentes e blocos | Transformar qualquer circuito montado numa peça reutilizável da biblioteca |
| 8 | Protoboard / placa | A mesma netlist mostrada como protoboard e depois como PCB, com serigrafia |
| 9 | Distribuição | Ícones, assinatura e notarização no macOS, atualização automática |

MVP: fases 0 a 2.

## Microcontroladores

### Um motor, vários chips

Na fase 5 o ATmega328P não é feito "à mão": ele é a primeira descrição de um motor de MCU genérico. Cada chip é um arquivo de dados com:

- **Encapsulamento e pinagem:** desenho, serigrafia e o que cada pino pode fazer (GPIO, alimentação, cristal, reset…).
- **Elétrica:** tensão de operação, faixa permitida, tensão máxima em cada pino (com ou sem tolerância a 5 V), corrente por pino e total, consumo em repouso e em pico, limiares de 0 e 1 na entrada.
- **Circuito interno do pino:** driver push-pull, pull-up/pull-down, diodos de proteção. Vira elementos do simulador, como qualquer peça.
- **Mapa de registradores:** nome, endereço, bits e o efeito de cada bit no pino. É o que aparece clicável no chip aberto e o que a sequência visual de passos escreve.
- **Exigências para funcionar:** cristal, capacitores de desacoplamento, memória externa, pinos de boot. Sem elas o chip fica parado, e o inspetor explica o que falta.

Um chip novo é um arquivo novo mais o desenho. Só entra código novo quando o chip traz um conceito que o motor ainda não tem.

### Chips da fase 6

Ordem de implementação: do que mais reaproveita a fase 5 para o que mais traz de novo.

| Chip | Tensão | O que ensina de diferente |
|---|---|---|
| **ATtiny85** | 1,8–5,5 V | Mesmo núcleo AVR do ATmega328P em 8 pinos. Cada pino acumula várias funções, e até o RESET pode virar GPIO (perdendo o reset). |
| **RP2040** | 3,3 V (núcleo a 1,1 V, com regulador interno) | Os GPIO **não toleram 5 V**: ligar 5 V num pino queima o chip. Não roda sozinho: precisa de cristal de 12 MHz e de memória flash externa. Registradores com escrita atômica (SET/CLR/XOR). |
| **ESP32** (módulo WROOM-32) | 3,3 V | Consome picos de ~500 mA quando o rádio liga: com fonte ou regulador fracos, a tensão afunda e ele reinicia (brownout). Isso conversa com o AMS1117 que já existe. Pinos de boot (GPIO0, 2, 12, 15) mudam o comportamento na partida, e os GPIO 34–39 são só entrada. |
| **STM32F103C8** | 3,3 V | ARM Cortex-M3. O GPIO só responde depois que o clock dele é ligado (RCC): escrever nos registradores sem isso não faz nada. Cada pino se configura com 4 bits (CRL/CRH). Alguns pinos toleram 5 V (FT) e outros não. |
| **PIC16F628A** | 2–5,5 V | Lógica invertida em relação ao AVR: no TRIS, 1 = entrada. Sem registrador LAT, ele mostra o problema de leitura-modificação-escrita: um pino com carga pesada é lido errado e "desliga" sozinho. |

### Peças de apoio

Entram junto com os chips que precisam delas:

- **Cristais e ressonadores** (8, 12 e 16 MHz) com os capacitores de carga.
- **Capacitores de desacoplamento** de 100 nF. Sem eles, os picos de consumo derrubam a tensão do chip.
- **Conversor de nível** com MOSFET (BSS138), para ligar 3,3 V e 5 V sem queimar o lado de 3,3 V.
- **Memória flash SPI**, que o RP2040 exige.

## Andamento

- [x] **Fase 0** — fundação.
- [x] **Fase 1** — editor livre. 12 peças com marcações explicadas (bateria 9V, pilha AA, USB 5V, fonte de bancada, resistor, potenciômetro, capacitor eletrolítico/cerâmico, indutor, LED, diodo, NPN, MOSFET); fios livres com junções e pontas soltas; girar, espelhar, duplicar, desfazer; netlist com detecção de curto direto; salvar/abrir `.abp`.
- [x] **Fase 2** — simulação DC ao vivo + energia. Simulador em Rust (`crates/sim-core`: análise nodal + Newton-Raphson, com gmin/source stepping de reserva) compilado para WebAssembly e rodando a cada mudança. Peças queimam (a mais sobrecarregada primeiro), o fusível do USB desarma, a fonte de bancada entra em CC. Modo Energia: fios coloridos por tensão e partículas de corrente; modo Testar: tensão em cada nó; inspetor com a conta passo a passo, caminho da energia e balanço entregue = consumido.
- [x] **Fase 3** — transiente + instrumentos. Simulação no tempo (Euler implícito, estado de capacitores e indutores guardado entre quadros, passos subdivididos se o Newton não convergir, amortecimento adaptativo contra oscilação); laço em tempo real que dorme quando nada muda. Peças novas: botão (apertar segurando o clique), chave SPDT (clique na alavanca), fusível F/T (queima instantânea ou por sobrecarga sustentada), reguladores 7805 e AMS1117-3.3 (dropout, limite de corrente, proteção térmica, dissipador). Controles: pausar (`P`), passo (`.`), câmera lenta até 1/1000×, reiniciar. Modo Testar com bancada: multímetro (V, alicate A, Ω com bipe de continuidade) e osciloscópio de 2 canais, com pontas de prova arrastáveis no circuito.
- [x] **Fase 4** — lógica digital do zero. Do zero: PNP (2N3906, BC557) e MOSFETs de sinal canal N/P (2N7000, BS250) para montar portas CMOS com transistores. Chips DIP gerados a partir de dados (pinagem, função de cada pino, família elétrica): 74HC00/04/08/32/86, 74HC74, CD4017 e NE555, com pontinhos de nível lógico nos pinos e tabela-verdade ao vivo no inspetor. Cada porta tem atraso de propagação (reage às entradas do passo anterior), o que faz latches, flip-flops e osciladores em anel se comportarem como na vida real. Avisos de entrada solta, tensão intermediária, alimentação pela entrada; 74HC queima acima de 7 V. Roteador de fios A* que nunca passa por pinos, pontas ou dobras de outros fios nem corre por cima deles.
- [x] **Fase 5** — microcontrolador por dentro. ATmega328P (DIP-28, nomes do Arduino em cada pino; AVCC alimenta a porta C; dois GND; fusível de cristal externo sem cristal = sem clock). "Por dentro do pino" para todos os microcontroladores: MOSFETs P/N do driver, pull-up/pull-down com chave, diodos de proteção e buffer de entrada, acendendo o que conduz, com tensão e corrente reais.
- [x] **Fase 6** — mais microcontroladores. Motor genérico descrito por dados (`src/mcu/specs.ts`): pinagem, elétrica, registradores por papel (dir/dirInv/out/in/pull/set/clr/xor/mode4/clock/rbpu/cmcon), exigências para funcionar e pinos de boot. Registradores voláteis clicáveis bit a bit com o chip ligado; sequência de passos gravada no projeto (o "programa" sem código). ATtiny85 (PORT = pull-up em entrada, fusível RSTDISBL), RP2040 (precisa de flash SPI, núcleo de 1,1 V pelo VREG, pull-down de fábrica, SET/CLR/XOR, 5 V queima), ESP32 WROOM-32 (EN sem pull-up, GPIO0/GPIO12 na partida, picos do rádio e brownout, GPIO34/35 só entrada), STM32F103C8 (clock da porta no RCC, CRL/CRH, BOOT0, pinos FT), PIC16F628A (TRIS invertido, comparadores no PORTA, leitura-modificação-escrita, RA4 open-drain, MCLR, brown-out a ~4 V). Apoio: cristal, flash W25Q16, conversor de nível BSS138. Queimas instantâneas acontecem antes das proteções, e queimas por calor depois.
- [x] **Fase 7** — seus blocos. Peça "Pino do bloco" marca os pontos que viram pinos; ⌘G (ou o botão da barra) transforma a seleção num bloco, salvo no projeto e listado em "Meus blocos". Blocos podem conter blocos. Na simulação, o documento é "achatado" (`src/features/blocks/blocks.ts`): as peças de dentro funcionam, queimam (o dano fica guardado no bloco) e microcontroladores rodam. Inspetor: renomear, ver as peças de dentro ao vivo, trocar as queimadas, desmontar.
- [x] **Fase 8** — protoboard e placa, geradas a partir do esquema (só leitura). Protoboard: chips sobre o canal central, GND e alimentação nos trilhos, uma tira de 5 furos por nó, fios de ligação quando a tira enche ou quando o pino de um chip precisa chegar ao seu nó; fontes e blocos ficam ao lado, com fios. Placa: pads nas posições do esquema, serigrafia (referência, valor, contorno, polaridade, pad quadrado no pino 1), trilhas roteadas por A* em duas faces, com folga em volta dos pads; o que não couber fica como linha tracejada.
- [x] **Placas prontas** — blocos embutidos montados com as peças do app (`src/features/blocks/boards.ts`): estilo Uno (ATmega328P), estilo Pico (RP2040), ESP32 DevKit, estilo Blue Pill (STM32F103) e estilo Digispark (ATtiny85). Cada uma com USB, regulador, cristal/flash quando precisa, LED e botões. No inspetor: botões da placa, registradores e sequência do chip (gravada em cada cópia) e o pino por dentro. Um teste garante, placa por placa, que nenhuma ligação interna está errada e que ela liga sozinha pelo USB.
- [x] **Sistemas prontos** — 31 circuitos completos para estudar, na aba Sistemas da biblioteca (`src/features/systems`), do mais simples ao mais completo: energia, transistores, temporizadores, lógica digital e microcontroladores. Cada um abre como circuito normal, editável, com um guia no inspetor (como funciona, as contas, o papel de cada peça, o que experimentar). Juntos, usam todas as peças da biblioteca. São descritos por dados e roteados na hora, com junções em T, trilhos de alimentação e fios que não passam sobre as peças. Um teste por sistema mede na simulação o que o guia promete, inclusive os experimentos: `pnpm test` falha se um número do texto deixar de valer. No simulador, entraram a fuga do canal dos MOSFETs (nós entre dois MOSFETs desligados agora têm tensão definida) e capacitância parasita nos nós como último recurso do transiente (viradas regenerativas, como a do multivibrador astável, agora convergem).

## Atalhos

| Tecla | Ação |
|---|---|
| `V` / `W` | Selecionar / desenhar fio |
| `R` / `F` | Girar 90° / espelhar (também com a peça na mão) |
| `⌫` | Apagar |
| `⌘D` | Duplicar |
| `⌘A` | Selecionar tudo |
| `⌘Z` / `⇧⌘Z` | Desfazer / refazer |
| `⌘N` / `⌘O` / `⌘S` / `⇧⌘S` | Novo / abrir / salvar / salvar como |
| `E` | Ligar/desligar a energia (simulação) |
| `P` / `.` | Pausar ou continuar / avançar um quadro |
| `Esc` | Soltar a peça, terminar o fio ou limpar a seleção |
| Espaço + arrastar | Mover a vista |
| Ctrl/pinça + rolar | Zoom |

## Modelo de dados (núcleo)

```ts
Component { id, kind, pos, rot, flip, props, markings }   // markings: textos impressos na peça
Pin       { componentId, name, role: "power_in" | "power_out" | "gnd" | "io" | "passive", limits }
Wire      { id, points[], ends: (PinRef | WirePoint)[] }    // pode terminar em pino ou no meio de outro fio
Net       { id, name, members[] }                            // derivado das ligações
SimResult { nodeVoltages, branchCurrents, power, damage[], warnings[] }
```
