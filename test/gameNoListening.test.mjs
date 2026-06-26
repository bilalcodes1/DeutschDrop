import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { ADVENTURE_MODES } from '../dist/services/adventureGame.js';

const root = new URL('../', import.meta.url);

function read(path) {
    return fs.readFileSync(new URL(path, root), 'utf8');
}

test('listening adventure mode is removed from constants and mode picker callbacks', () => {
    assert.equal(ADVENTURE_MODES.some(item => item.mode === 'listen_repeat'), false);
    const gameCommand = read('src/commands/game.ts');
    assert.doesNotMatch(gameCommand, /listen_repeat/);
    assert.doesNotMatch(gameCommand, /🎧 اسمع ← كرر النطق/);
});

test('smart boss and hard modes cannot generate listen_repeat sessions', () => {
    const serviceSource = read('src/services/gameSessionService.ts');
    assert.match(serviceSource, /normalizeCollectionGameMode/);
    assert.match(serviceSource, /mode === 'listen_repeat' \? 'arabic_speech'/);
    assert.doesNotMatch(serviceSource.slice(serviceSource.indexOf('createGameSessionFromWords'), serviceSource.indexOf('export async function getPublicGameState')), /listen_repeat[^?]/);
});

test('pre-answer public game question does not include German answer or pronunciation text', () => {
    const serviceSource = read('src/services/gameSessionService.ts');
    const publicQuestionInterface = serviceSource.slice(serviceSource.indexOf('export interface PublicGameQuestion'), serviceSource.indexOf('export interface PublicGameState'));
    const publicQuestionFunction = serviceSource.slice(serviceSource.indexOf('function publicQuestion'), serviceSource.indexOf('function imageUrlForQuestion'));

    assert.doesNotMatch(publicQuestionInterface, /correctAnswer|correctPronunciationText|german/i);
    assert.doesNotMatch(publicQuestionFunction, /correctAnswer|correctPronunciationText/);
});

test('pre-answer game UI has no pronunciation listen button or answer audio token', () => {
    const htmlSource = read('src/game/html.ts');
    const renderPlay = htmlSource.slice(htmlSource.indexOf('function renderPlay'), htmlSource.indexOf('function startQuestionTimer'));

    assert.doesNotMatch(renderPlay, /soundBtn|اسمع النطق|correctPronunciationText|speakGerman/);
    assert.doesNotMatch(renderPlay, /سماع مجاني|🎧/);
});

test('post-loss result still exposes correct pronunciation only after final incorrect', () => {
    const htmlSource = read('src/game/html.ts');
    const gameOver = htmlSource.slice(htmlSource.indexOf('function renderGameOver'), htmlSource.indexOf('function renderWin'));

    assert.match(gameOver, /🔊 اسمع النطق الصحيح/);
    assert.match(gameOver, /failed\.correctAnswer/);
    assert.match(gameOver, /speakGerman/);
});

test('game image endpoint still trusts token and word id only', () => {
    const routeSource = read('src/game/routes.ts');
    const imageBlock = routeSource.slice(routeSource.indexOf("url.pathname === '/game/api/image'"), routeSource.indexOf("url.pathname === '/game/api/answer'"));
    assert.match(imageBlock, /token/);
    assert.match(imageBlock, /wordId/);
    assert.doesNotMatch(imageBlock, /assetId|userId/);
});
