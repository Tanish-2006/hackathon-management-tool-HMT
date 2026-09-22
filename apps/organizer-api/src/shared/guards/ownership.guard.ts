import { FastifyRequest, FastifyReply } from 'fastify';
import { memoryStore } from '../../store/memory.store';
import { getUser } from './auth.guard';

// Enforce organization/hackathon ownership.
// Organizer must own the hackathon via organizerId, Mentor can only access assigned teams, Admin bypasses.

export async function enforceHackathonOwnership(request: FastifyRequest, reply: FastifyReply) {
  const user = getUser(request);
  if (user.role === 'ADMIN') return;

  const hackathonId = (request.params as any)?.id || (request.params as any)?.hackathonId;
  if (!hackathonId) return; // no hackathon scope, skip

  const hackathon = memoryStore.hackathons.get(hackathonId);
  if (!hackathon) {
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Hackathon not found' } });
  }

  // Organizer must be owner
  if (user.role === 'ORGANIZER') {
    if (hackathon.organizerId !== user.id) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Not owner of this hackathon' } });
    }
  }

  // Mentor: must have assignment to hackathon (any team) - enforced here for
  // hackathon-scoped routes. Team-scoped mentor routes enforce team assignment per-route.
  if (user.role === 'MENTOR') {
    const hasAssignment = Array.from(memoryStore.mentorAssignments.values()).some(
      (a) => a.hackathonId === hackathonId && a.mentorId === user.id,
    );
    if (!hasAssignment) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Mentor is not assigned to this hackathon' } });
    }
  }

  // PARTICIPANT should not access organizer private endpoints; but they might view published via sync
  if (user.role === 'PARTICIPANT') {
    if (hackathon.status !== 'PUBLISHED' && hackathon.status !== 'ARCHIVED') {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Participants can only view published hackathons' } });
    }
  }
}
