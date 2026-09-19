import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPhotoDTO, photoDTOSchema } from './photo.ts';
import type { Photo } from '~/server/db/schema';

const fixturePhoto: Photo = {
  unique_id: 'abc-123',
  activity_id: 12345678901234,
  athlete_id: 123456789,
  activity_name: 'Morning Run',
  caption: null,
  type: 1,
  source: 1,
  urls: { '600': 'https://example.com/600.jpg' },
  sizes: { '600': [600, 400] },
  default_photo: true,
  location: [47.1, 8.5],
  uploaded_at: new Date('2024-01-31T08:00:00.000Z'),
  created_at: new Date('2024-01-31T08:00:00.000Z'),
  post_id: null,
  status: null,
  resource_state: 2,
};

void test('toPhotoDTO encodes activity_id/athlete_id as strings', () => {
  const dto = toPhotoDTO(fixturePhoto);
  assert.equal(dto.activity_id, '12345678901234');
  assert.equal(dto.athlete_id, '123456789');
  assert.equal(dto.uploaded_at, '2024-01-31T08:00:00.000Z');
});

void test('toPhotoDTO maps null timestamps through as null', () => {
  const dto = toPhotoDTO({ ...fixturePhoto, uploaded_at: null, created_at: null });
  assert.equal(dto.uploaded_at, null);
  assert.equal(dto.created_at, null);
});

void test('photoDTOSchema accepts the mapped DTO shape', () => {
  const dto = toPhotoDTO(fixturePhoto);
  assert.equal(photoDTOSchema.safeParse(dto).success, true);
});
