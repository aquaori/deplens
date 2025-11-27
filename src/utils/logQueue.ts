import { LogQueue } from '../types';
import { log } from './cli-utils';

const logQueue: LogQueue[] = [];

export function logInQueue(message: LogQueue['message'], type: LogQueue['type'] = 'info') {
    logQueue.push({type, message});
}

export function spitOutQueue() {
    logQueue.forEach(item => log(item.type as any, item.message));
    logQueue.length = 0;
}
