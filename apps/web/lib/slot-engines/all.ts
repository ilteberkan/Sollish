import { slotEnginesOf } from '../rgs-client';
import { ASENA_ENGINE } from './asena';
import { CASCADE_ENGINE } from './cascade';
import { CEZERI_ENGINE } from './cezeri';
import { EBRU_ENGINE } from './ebru';
import { TARHUN_ENGINE } from './tarhun';

/** Every slot engine. Only /verify and /replay (not hot paths) import this; a game route imports its own engine file. */
export const ALL_SLOT_ENGINES = slotEnginesOf(CASCADE_ENGINE, TARHUN_ENGINE, EBRU_ENGINE, CEZERI_ENGINE, ASENA_ENGINE);
