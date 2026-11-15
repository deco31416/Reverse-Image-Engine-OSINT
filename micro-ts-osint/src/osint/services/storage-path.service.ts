import { Injectable } from '@nestjs/common';

@Injectable()
export class StoragePathService {
  searchFolder(query: string, clusterLetter: string, searchId: string, kind: string) {
    return `searches/${this.safeSegment(clusterLetter || '_')}/${this.safeSegment(query || 'unknown-search')}/${this.safeSegment(searchId || 'pending')}/${this.safeSegment(kind || 'original')}`;
  }

  searchName(query?: string, kind?: string) {
    return `${this.safeSegment(query || 'unknown-search')}-${this.safeSegment(kind || 'image')}`;
  }

  faceFolder(searchId: string, kind: string) {
    return `searches/_/face-search/${this.safeSegment(searchId || 'unknown-search')}/faces/${this.safeSegment(kind || 'original')}`;
  }

  personDetectionFolder(searchIdOrName: string, kind: string) {
    const label = this.safeSegment(searchIdOrName || 'unknown-person');
    const letter = /^[a-z0-9]/.test(label.charAt(0)) ? label.charAt(0).toUpperCase() : '_';
    return `searches/${letter}/${label}/person-detection/${this.safeSegment(kind || 'original')}`;
  }

  safeSegment(value: string) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || '_';
  }
}
