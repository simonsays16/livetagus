# LiveTagus v2

A LiveTagus acompanha os comboios da Fertagus em tempo real com posição,
atrasos, ocupação e avisos. Está online em **[livetagus.pt](https://livetagus.pt)**.

Este branch é a **v2**, um redesign da PWA.

---

## ⚠️ Isto é uma beta, e está extremamente instável!

Se chegaste aqui à procura da LiveTagus, **não é este o sítio**. Usa a
[livetagus.pt](https://livetagus.pt), que corre a partir da `main` e é a versão
estável.

Este branch é trabalho em curso, feito em público. Espera funcionalidades
partidas, dados errados, ecrãs meio desenhados e coisas que mudam de sítio de
um dia para o outro. Não é utilizável no dia a dia e não deve ser tratado como
tal.

Também não é autónoma. Precisa de ficheiros de dados que não estão no
repositório (gtfs), por isso clone e abrir não chega para o ver a funcionar.

## O que muda na v2

**O mapa passa a multimodal.** A Fertagus continua a ser o centro e é a razão de a app existir, mas o mapa passa a
mostrar também o Metro de Lisboa, o Metro Sul do Tejo, a CP e a Carris
Metropolitana, com horários, percursos das viagens e ligações entre operadores.

Plano de disponibilidade:

| Operadores AML                    | Horários e Linhas | Tempo Real                 |
| --------------------------------- | ----------------- | -------------------------- |
| Fertagus                          | ✅                | (Em Resolução)             |
| Carris Metropolitana (Área 3 e 4) | ✅                | ✅                         |
| Carris Metropolitana (Área 1 e 2) | ⌛                | ⌛                         |
| Metro de Lisboa                   | ✅                | ⌛                         |
| Metro Transportes do Sul          | ✅                | ❌                         |
| CP                                | ✅                | (Atalho para Site Oficial) |
| TCB                               | ⌛                | ⌛                         |
| Carris                            | Em Análise        | ❌                         |
| Transtejo                         | ❌                | ❌                         |

**Planeador de viagem.** Permite planear a tua viagem com antecedência. Selecionas a data e a hora a que queres chegar/partir de uma estação e recebes uma proposta de viagem. O planeador avisa para trajetos com ocupação elevada e sugere horários com ocupações menores.

**"A minha paragem" muda de propósito.** Deixa de ser uma lista de paragens
guardadas para consulta e passa a ser o sítio onde escolhes que paragens de
autocarro queres ver no teu mapa.

**Perto de mim.** Mostra os transportes mais próximos, com raio ajustável. A
localização é obtida e usada apenas no teu dispositivo. Não é enviada para
lado nenhum, não é guardada, e desaparece quando fechas a página. A estação da Fertagus mais próxima aparece sempre no topo.

**Muitas correções e muitos acertos pequenos**, incluindo bugs antigos que estavam
lá há meses sem ninguém dar por eles.

## O que ainda não está bem

Vale a pena ser claro sobre os limites, porque alguns são do próprio dado e não
se resolvem com código:

- **Os horários do Metro de Lisboa não são horários.** O feed publica
  frequências ("de 4 em 4 minutos"), não partidas. As horas mostradas são
  interpoladas a partir desse intervalo, por isso ainda estamos a averiguar a situação.
- **A CP só cobre a região de Lisboa** nesta versão, e os horários são os
  programados. Para tempo real há um atalho para o site da CP.
- **Só a Fertagus e a Carris Metropolitana têm tempo real.**
- Etiquetas de estação podem desaparecer: as fontes do mapa vêm de um servidor
  de demonstração, sem garantias de disponibilidade.
- Alguns ecrãs carregam bastantes dados. Ainda não está optimizado.

## FAQ

<details>
<summary>
<b>A LiveTagus voltou?</b>
</summary>

A LiveTagus nunca foi embora, apenas ficou com menos informação disponível. Infelizmente isso não vai mudar para já. PLaneio lançar esta atualização quando voltarmos a ter os dados todos!

</details>
<p></p>
<details>
<summary>
<b>Quando vai ser lançada?</b>
</summary>

Também gostava de saber :)

</details>
<p></p>
<details>
<summary>
<b>Como lidamos com tantos horários?</b>
</summary>

Os horários dos operadores vêm de bundles
gerados pelo [`gtfs-departures`](https://gtfs-departures.livetagus.pt), uma
ferramenta que fiz para transformar feeds GTFS (Padrão Internacional) em JSON divididos por estação para carregar mais rápido.

</details>
<p></p>
<details>
<summary>
<b>Mesmo assim queres ver como está?</b>
</summary>

A PWA BETA **INSTÁVEL** está disponível em [`beta.livetagus.pt`](https://beta.livetagus.pt) e **APENAS** em fase de testes, os termos e condições, política de privacidade podem estar desatualizados por ser uma versão dev.

</details>

<details>
<summary>
<b>Encontrei um erro na beta. Onde aviso?</b>
</summary>

Como isto ainda está em construção, os erros são normais. Abre um _Issue_ aqui e explica o que falhou (exemplo: qual era a estação, o operador).

</details>

<details>
<summary>
<b>Isto é uma app oficial da Fertagus?</b>
</summary>

**Não.** A LiveTagus é um projeto **100% independente**, desenvolvido e mantido por mim. Não tem qualquer ligação institucional, patrocínio ou afiliação com a Fertagus, Infraestruturas de Portugal ou qualquer outro operador de transportes.

</details>
<p></p>

---

Projecto pessoal e independente. Sugestões e relatos de
erros são bem-vindos nos _issues_.
