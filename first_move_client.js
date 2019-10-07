const axios = require('axios');

const StateType = {
    WaitingPlayers: 'Waiting for Players',
};

const sleep = ms => new Promise((resolve) => {
    setTimeout(resolve, ms);
});

const isPlayerWhite = playerData => playerData.color === 'White';

var httpClient = axios.create({
    baseURL: 'http://localhost:7861',
});

const joinGame = async () => {
    if (process.argv.length < 3) {
        throw "No team name argument given";
    }

    const teamName = process.argv[2];

    try {
        const response = await httpClient.post('/register', {
            teamName,
        });

        return response.data;
    } catch (err) {
        console.error(err.response.data);
        return null;
    }
};

const getState = async () => {
    const response = await httpClient.get('/getState');
    return response.data;
};

const getDiceFromState = state => {
    return state.Dice.filter(die => die !== 0);
}

const waitForPlayers = async () => {
    let state = await getState();
    let stateText = state.State;
    if (stateText === StateType.WaitingPlayers) {
        console.log('Waiting for another player');
        while (stateText === StateType.WaitingPlayers) {
            await sleep(1000);
            state = await getState();
            stateText = state.State;
        }
    }
};

const isItMyTurn = (playerData, state) => {
    if (isPlayerWhite(playerData)) {
        return state.WhiteTurn;
    }

    return !state.WhiteTurn;
};

const amIEaten = (playerData, state) => {
    if (isPlayerWhite(playerData)) {
        return state.Board.whiteEaten > 0;
    }

    return state.Board.blackEaten > 0;
};

const returnToBarDestination = (playerData, state) => {
    const dice = getDiceFromState(state);

    for (didx in dice) {
        const die = dice[didx];
        const dest = (() => {
            if (isPlayerWhite(playerData)) {
                const dest = die - 1;
                if (state.Board.columns[dest].BlackCheckers < 2) {
                    return dest;
                }
            } else {
                const dest = 24 - die;
                if (state.Board.columns[dest].whiteCheckers < 2) {
                    return dest;
                }
            }

            return null;
        })()

        return dest;
    }

    return null;
};

const allCheckersAtHome = (playerData, state) => {
    const { columns } = state.Board;

    if (isPlayerWhite(playerData)) {
        for (idx in columns) {
            if (idx < 18 && columns[idx].whiteCheckers > 0) {
                return false;
            }
        }
    } else {
        for (idx in columns) {
            if (idx > 5 && columns[idx].BlackCheckers > 0) {
                return false;
            }
        }
    }

    return true;
};

const anyCheckerToBearOff = (playerData, state) => {
    const dice = getDiceFromState(state);

    for (didx in dice) {
        const die = dice[didx];
        if (isPlayerWhite(playerData)) {
            if (state.Board.columns[24 - die].whiteCheckers > 0) {
                return 24 - die;
            }

            for (let i = 23 - die; i >= 18; i--) {
                if (state.Board.columns[i].whiteCheckers > 0) {
                    return null;
                }
            }

            for (let i = 25 - die; i < 24; i++) {
                if (state.Board.columns[i].whiteCheckers > 0) {
                    return i;
                }
            }

            return null;
        } else {
            if (state.Board.columns[die - 1].BlackCheckers > 0) {
                return die - 1;
            }

            for (let i = die; i <= 5; i++) {
                if (state.Board.columns[i].BlackCheckers > 0) {
                    return null;
                }
            }

            for (let i = die - 2; i >= 0; i--) {
                if (state.Board.columns[i].BlackCheckers > 0) {
                    return i;
                }
            }
        }
    }

    return null;
};

const moveWithDice = (playerData, state) => {
    const amIWhite = isPlayerWhite(playerData);
    const { columns } = state.Board;
    for (idx in columns) {
        if ((amIWhite && columns[idx].whiteCheckers > 0)
            || (!amIWhite && columns[idx].BlackCheckers > 0)) {
            const dice = getDiceFromState(state);

            for (didx in dice) {
                const die = dice[didx];
                if (amIWhite) {
                    const dest = die + idx;
                    if (dest >= 0 && dest < 24 && state.Board.columns[dest].BlackCheckers < 2) {
                        return [idx, dest];
                    }
                }

                const dest = idx - die;
                if (dest >= 0 && dest < 24 && state.Board.columns[dest].whiteCheckers < 2) {
                    return [idx, dest];
                }
            }
        }
    }
}

const firstPlayableMove = (playerData, state) => {
    if (amIEaten(playerData, state)) {
        return [-1, returnToBarDestination(playerData, state)];
    } else if (allCheckersAtHome(playerData, state)) {
        const checkerToBearOff = anyCheckerToBearOff(playerData, state);
        if (checkerToBearOff !== null) {
            return [checkerToBearOff, -1];
        }
    }

    return moveWithDice(playerData, state);
};

const sendMoveAction = async (move) => {
    const newState = await httpClient.post('/move', move);
    return newState.data;
};

const play = async (playerData) => {
    try {
        let state = await getState();
        let gameEnded = false;

        const checkEndedInterval = setInterval(() => {
            if(state.WhiteWon || state.BlackWon) {
                console.log(state);
                console.log('finished game');
                gameEnded = true;
                clearInterval(checkEndedInterval);
            }
        }, 1000);

        while (!gameEnded && !state.WhiteWon && !state.BlackWon) {
            while (!isItMyTurn(playerData, state) || state.Status !== "") {
                await sleep(200);
                state = await getState();
            }

            // Reaching here means that it is this player's turn
            const nextMoveData = firstPlayableMove(playerData, state);
            const nextMove = {
                from: parseInt(nextMoveData[0]),
                to: parseInt(nextMoveData[1]),
                playerID: playerData.playerID,
            };

            state = await sendMoveAction(nextMove);
            console.log(nextMove);
        }
    } catch (err) {
        console.error(err);
    }
};

const run = async () => {
    const playerData = await joinGame();
    if (playerData) {
        await waitForPlayers();
        await play(playerData);
    }
};

run();