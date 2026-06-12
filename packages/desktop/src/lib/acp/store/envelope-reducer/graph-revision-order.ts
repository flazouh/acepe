import type { SessionGraphRevision } from "../../../services/acp-types.js";

export function isNewerGraphRevision(
	current: SessionGraphRevision | null,
	incoming: SessionGraphRevision
): boolean {
	if (current === null) {
		return true;
	}

	if (incoming.graphRevision !== current.graphRevision) {
		return incoming.graphRevision > current.graphRevision;
	}

	if (incoming.lastEventSeq !== current.lastEventSeq) {
		return incoming.lastEventSeq > current.lastEventSeq;
	}

	return incoming.transcriptRevision > current.transcriptRevision;
}

export function isOlderGraphRevision(
	current: SessionGraphRevision | null,
	incoming: SessionGraphRevision
): boolean {
	if (current === null) {
		return false;
	}

	if (incoming.graphRevision !== current.graphRevision) {
		return incoming.graphRevision < current.graphRevision;
	}

	if (incoming.lastEventSeq !== current.lastEventSeq) {
		return incoming.lastEventSeq < current.lastEventSeq;
	}

	return incoming.transcriptRevision < current.transcriptRevision;
}
