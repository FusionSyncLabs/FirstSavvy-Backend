const { prisma } = require('../config/database');
const { ApiError } = require('../middleware/errorHandler');
const { ERROR_CODES, HTTP_STATUS } = require('../constants/errorCodes');
const { parsePaginationQuery, buildPaginationMeta } = require('../utils/pagination');
const { createNotificationForUser } = require('./notification.service');
const {
  deleteObject,
  extractKeyFromPublicUrl,
  uploadPublicObject
} = require('./fileStorage.service');

const CONTACT_AVATAR_MAX_BYTES = 5 * 1024 * 1024;

const CONTACT_METADATA_FIELDS = [
  'address',
  'status',
  'tags',
  'color',
  'linked_user_id',
  'connection_status',
  'relationship_metadata'
];

const CONTACT_SORT_FIELDS = new Set([
  'name',
  'created_at',
  'updated_at',
  'email',
  'group_name'
]);

async function listContactsForProfile(profileId, query = {}) {
  const pagination = parsePaginationQuery(query, {
    defaultLimit: 100,
    maxLimit: 1000
  });
  const where = buildContactWhere(profileId, query);
  const orderBy = buildContactOrder(query.orderBy || 'name');

  const [contacts, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy,
      skip: pagination.skip,
      take: pagination.take
    }),
    prisma.contact.count({ where })
  ]);

  return {
    contacts: contacts.map(pickPublicContact),
    pagination: buildPaginationMeta({
      page: pagination.page,
      limit: pagination.limit,
      total
    })
  };
}

async function getContactForProfile(profileId, contactId) {
  const contact = await findContact(profileId, contactId);
  return pickPublicContact(contact);
}

async function listIncomingContactRequestsForUser(userId) {
  const user = await findActiveUserForContactFlow(userId);
  const userPhoneDigits = normalizePhoneDigits(user.user_setting?.settings?.phone);
  const contacts = await prisma.contact.findMany({
    where: {
      deleted_at: null
    },
    include: {
      profile: {
        select: {
          id: true,
          name: true,
          display_name: true
        }
      }
    },
    orderBy: { created_at: 'desc' }
  });

  return {
    requests: contacts
      .filter((contact) => isIncomingContactRequestForUser(contact, user, userPhoneDigits))
      .map((contact) => ({
        contact: pickPublicContact(contact),
        profile: contact.profile,
        request_type: getRelationshipRequest(getContactMetadata(contact))?.type || getContactMetadata(contact).connection_status
      }))
  };
}

function validateContactName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    throw ApiError.badRequest('Contact name is required', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'name', message: 'Required field is missing' }]
    });
  }
  if (trimmed.length < 2) {
    throw ApiError.badRequest('Contact name must be at least 2 characters long', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'name', message: 'Contact name must be at least 2 characters long' }]
    });
  }
  if (!/[a-zA-Z\p{L}]/u.test(trimmed)) {
    throw ApiError.badRequest('Contact name must contain letters and cannot consist solely of numbers or special characters', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'name', message: 'Contact name must contain letters' }]
    });
  }
  return trimmed;
}

async function createContactForProfile(profileId, input = {}, userId = null) {
  const name = validateContactName(input.name);

  const data = buildContactData(input);
  const requestedStatus = data.metadata?.connection_status;
  const createConnectionStatus = ['pending', 'invited'].includes(requestedStatus)
    ? requestedStatus
    : 'manual';

  data.metadata = {
    ...(data.metadata || {}),
    connection_status: createConnectionStatus,
    linked_user_id: null
  };

  await ensureContactEmailIsAvailable(profileId, data.email, { userId });

  const contact = await prisma.contact.create({
    data: {
      profile_id: profileId,
      ...data,
      name
    }
  });

  return pickPublicContact(contact);
}

async function updateContactForProfile(profileId, contactId, input = {}, userId = null, options = {}) {
  const existingContact = await findContact(profileId, contactId);

  const data = buildContactData(input, { partial: true });
  if (input.name !== undefined) {
    data.name = validateContactName(input.name);
  }
  await ensureContactEmailIsAvailable(profileId, data.email, {
    userId,
    excludeContactId: contactId
  });

  if (data.metadata) {
    const existingMetadata = existingContact.metadata &&
      typeof existingContact.metadata === 'object' &&
      !Array.isArray(existingContact.metadata)
      ? existingContact.metadata
      : {};

    if (
      (data.metadata.linked_user_id && data.metadata.linked_user_id !== existingMetadata.linked_user_id) ||
      (data.metadata.connection_status === 'connected' && existingMetadata.connection_status !== 'connected')
    ) {
      throw ApiError.badRequest('Contact relationships must be accepted by the invitee before they can be connected', {
        code: ERROR_CODES.VALIDATION_FAILED,
        details: [{ location: 'body', field: 'connection_status', message: 'Use the contact request acceptance flow' }]
      });
    }

    data.metadata = {
      ...existingMetadata,
      ...data.metadata
    };

    await ensureUserNotAlreadyLinked(profileId, data.metadata.linked_user_id, {
      excludeContactId: contactId
    });
  }

  const uploadedAvatar = options.avatarFile
    ? await uploadContactAvatar(options.avatarFile, { userId, profileId, publicFilesBaseUrl: options.publicFilesBaseUrl })
    : null;
  const hasAvatarUpdate = Boolean(uploadedAvatar) || input.remove_avatar === true || input.avatar_url !== undefined;

  if (uploadedAvatar) {
    data.avatar_url = uploadedAvatar.publicUrl;
  } else if (input.remove_avatar === true) {
    data.avatar_url = null;
  }

  if (Object.keys(data).length === 0) {
    throw ApiError.badRequest('No contact updates were provided', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }

  let contact;
  try {
    contact = await prisma.contact.update({
      where: { id: contactId },
      data
    });
  } catch (error) {
    if (uploadedAvatar?.publicUrl) {
      await deletePublicAvatar(uploadedAvatar.publicUrl);
    }
    throw error;
  }

  if (hasAvatarUpdate && existingContact.avatar_url && existingContact.avatar_url !== contact.avatar_url) {
    await deletePublicAvatar(existingContact.avatar_url);
  }

  return pickPublicContact(contact);
}

async function deleteContactForProfile(profileId, contactId) {
  const contact = await findContact(profileId, contactId);

  await prisma.contact.update({
    where: { id: contactId },
    data: {
      deleted_at: new Date()
    }
  });

  await deletePublicAvatar(contact.avatar_url);

  return { deleted: true };
}

async function withdrawContactRequestForProfile(profileId, contactId, userId = null) {
  const contact = await findContact(profileId, contactId);
  const metadata = getContactMetadata(contact);
  const request = getRelationshipRequest(metadata);

  if (!['pending', 'invited'].includes(metadata.connection_status) || request?.status !== 'pending') {
    throw ApiError.badRequest('Only pending contact requests can be withdrawn', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }

  await prisma.contact.delete({ where: { id: contactId } });

  return {
    withdrawn: true
  };
}

async function detectContactAccountForProfile(profileId, query = {}, userId = null) {
  const email = normalizeNullableString(query.email)?.toLowerCase();
  const phoneDigits = normalizePhoneDigits(query.phone);

  if (!email && !phoneDigits) {
    throw ApiError.badRequest('Email or phone is required for account detection', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'query', field: 'email', message: 'Provide email or phone' }]
    });
  }

  if (email) {
    await ensureContactEmailIsAvailable(profileId, email, { userId });
  }

  let user = null;

  if (email) {
    user = await prisma.user.findFirst({
      where: {
        email,
        deleted_at: null,
        NOT: {
          memberships: {
            some: {
              profile_id: profileId
            }
          }
        }
      },
      select: {
        id: true,
        email: true,
        full_name: true,
        avatar_url: true
      }
    });
  }

  if (!user && phoneDigits) {
    const settings = await prisma.userSetting.findMany({
      include: {
        user: {
          select: {
            id: true,
            email: true,
            full_name: true,
            avatar_url: true,
            deleted_at: true,
            memberships: {
              select: { profile_id: true }
            }
          }
        }
      }
    });

    const matchedSetting = settings.find((setting) => {
      if (setting.user?.deleted_at) return false;
      if (setting.user?.memberships?.some((membership) => membership.profile_id === profileId)) return false;
      return normalizePhoneDigits(setting.settings?.phone) === phoneDigits;
    });

    if (matchedSetting?.user) {
      user = matchedSetting.user;
    }
  }

  if (!user) {
    return { found: false, user: null };
  }

  const existingContact = await findContactLinkedToUser(profileId, user.id);

  return {
    found: true,
    user: pickPublicDetectedUser(user, phoneDigits),
    alreadyLinked: Boolean(existingContact),
    contact: existingContact ? pickPublicContact(existingContact) : null
  };
}

async function requestContactConnectionForProfile(profileId, contactId, input = {}, userId = null) {
  const contact = await findContact(profileId, contactId);
  const targetUserId = input.targetUserId || input.target_user_id || input.userId || input.user_id;

  if (!targetUserId) {
    throw ApiError.badRequest('Target user is required', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'targetUserId', message: 'Required field is missing' }]
    });
  }

  const targetUser = await prisma.user.findFirst({
    where: {
      id: targetUserId,
      deleted_at: null
    },
    select: {
      id: true,
      email: true,
      full_name: true,
      avatar_url: true
    }
  });

  if (!targetUser) {
    throw ApiError.notFound('Target user not found', {
      code: ERROR_CODES.USER_NOT_FOUND
    });
  }

  await ensureUserNotAlreadyLinked(profileId, targetUser.id, {
    excludeContactId: contactId
  });
  await ensureContactEmailIsAvailable(profileId, targetUser.email, {
    userId,
    excludeContactId: contactId
  });

  const metadata = mergeContactMetadata(contact, {
    linked_user_id: null,
    connection_status: 'pending',
    relationship_metadata: {
      ...(getContactMetadata(contact).relationship_metadata || {}),
      status: 'pending',
      request: buildRelationshipRequestMetadata({
        type: 'connection_request',
        status: 'pending',
        requestedByUserId: userId,
        targetUserId: targetUser.id,
        targetEmail: targetUser.email
      })
    }
  });

  const updatedContact = await prisma.$transaction(async (tx) => {
    const updated = await tx.contact.update({
      where: { id: contactId },
      data: { metadata }
    });

    await createNotificationForUser(targetUser.id, {
      source: 'contacts',
      source_id: contactId,
      event_type: 'contact.connection_requested',
      delivery_key: `contact:connection_requested:${contactId}:${targetUser.id}`,
      title: 'Connection request',
      body: `${contact.name} wants to connect with you.`,
      action_url: '/Contacts',
      priority: 'normal',
      metadata: {
        contact_id: contactId,
        requesting_profile_id: profileId,
        requested_by_user_id: userId
      }
    }, { db: tx });

    return updated;
  });

  return {
    contact: pickPublicContact(updatedContact),
    user: pickPublicDetectedUser(targetUser)
  };
}

async function inviteContactForProfile(profileId, contactId, input = {}, userId = null) {
  const contact = await findContact(profileId, contactId);
  const email = normalizeNullableString(input.email || contact.email)?.toLowerCase();
  const phone = normalizeNullableString(input.phone || contact.phone);

  if (!email && !phone) {
    throw ApiError.badRequest('Email or phone is required to invite a contact', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'email', message: 'Provide email or phone' }]
    });
  }

  await ensureContactEmailIsAvailable(profileId, email, {
    userId,
    excludeContactId: contactId,
    rejectUnlinkedPlatformUser: true
  });

  const metadata = mergeContactMetadata(contact, {
    connection_status: 'invited',
    relationship_metadata: {
      ...(getContactMetadata(contact).relationship_metadata || {}),
      status: 'pending',
      request: buildRelationshipRequestMetadata({
        type: 'invitation',
        status: 'pending',
        requestedByUserId: userId,
        inviteEmail: email,
        invitePhone: phone
      })
    }
  });

  const updatedContact = await prisma.contact.update({
    where: { id: contactId },
    data: { metadata }
  });

  return {
    contact: pickPublicContact(updatedContact),
    invitation: metadata.relationship_metadata.request
  };
}

async function acceptIncomingContactRequestForUser(contactId, userId) {
  const user = await findActiveUserForContactFlow(userId);
  const userPhoneDigits = normalizePhoneDigits(user.user_setting?.settings?.phone);
  const contact = await prisma.contact.findFirst({
    where: {
      id: contactId,
      deleted_at: null
    }
  });

  if (!contact || !isIncomingContactRequestForUser(contact, user, userPhoneDigits)) {
    throw ApiError.notFound('Contact request not found', {
      code: ERROR_CODES.CONTACT_NOT_FOUND
    });
  }

  await ensureUserNotAlreadyLinked(contact.profile_id, user.id, {
    excludeContactId: contact.id
  });

  const relationshipMetadata = {
    ...(getContactMetadata(contact).relationship_metadata || {}),
    status: 'accepted',
    request: buildAcceptedRelationshipRequestMetadata(contact, user.id)
  };

  const metadata = mergeContactMetadata(contact, {
    linked_user_id: user.id,
    connection_status: 'connected',
    relationship_metadata: relationshipMetadata
  });

  const updatedContact = await prisma.$transaction(async (tx) => {
    const updated = await tx.contact.update({
      where: { id: contact.id },
      data: { metadata }
    });

    const request = getRelationshipRequest(getContactMetadata(contact));
    await createNotificationForUser(request?.requested_by_user_id, {
      source: 'contacts',
      source_id: contact.id,
      event_type: 'contact.connection_accepted',
      delivery_key: `contact:connection_accepted:${contact.id}:${userId}`,
      title: 'Connection accepted',
      body: `${user.full_name || user.email} accepted your connection request.`,
      action_url: '/Contacts',
      priority: 'normal',
      metadata: {
        contact_id: contact.id,
        accepted_by_user_id: userId
      }
    }, { db: tx, fallbackProfileId: contact.profile_id });

    return updated;
  });

  return {
    contact: pickPublicContact(updatedContact)
  };
}

async function findContact(profileId, contactId) {
  const contact = await prisma.contact.findFirst({
    where: {
      id: contactId,
      profile_id: profileId,
      deleted_at: null
    }
  });

  if (!contact) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Contact not found', {
      code: ERROR_CODES.CONTACT_NOT_FOUND
    });
  }

  return contact;
}

async function findContactLinkedToUser(profileId, userId, options = {}) {
  if (!userId) return null;

  const contacts = await prisma.contact.findMany({
    where: {
      profile_id: profileId,
      deleted_at: null,
      ...(options.excludeContactId ? { id: { not: options.excludeContactId } } : {})
    }
  });

  return contacts.find((contact) => getContactMetadata(contact).linked_user_id === userId) || null;
}

async function ensureUserNotAlreadyLinked(profileId, userId, options = {}) {
  const existingContact = await findContactLinkedToUser(profileId, userId, options);

  if (!existingContact) return;

  throw ApiError.conflict('This profile is already connected to that user', {
    code: ERROR_CODES.CONTACT_ALREADY_LINKED,
    details: [{
      field: 'linked_user_id',
      message: 'A profile can connect with a user only one time',
      contact: {
        id: existingContact.id,
        name: existingContact.name,
        email: existingContact.email,
        phone: existingContact.phone
      }
    }]
  });
}

async function ensureContactEmailIsAvailable(profileId, email, options = {}) {
  if (email === undefined || email === null) return;

  const normalizedEmail = String(email).trim().toLowerCase();
  if (!normalizedEmail) return;

  const [currentUser, existingContact, platformUser] = await Promise.all([
    options.userId
      ? prisma.user.findFirst({
        where: {
          id: options.userId,
          deleted_at: null
        },
        select: {
          id: true,
          email: true
        }
      })
      : null,
    prisma.contact.findFirst({
      where: {
        profile_id: profileId,
        deleted_at: null,
        email: {
          equals: normalizedEmail,
          mode: 'insensitive'
        },
        ...(options.excludeContactId ? { id: { not: options.excludeContactId } } : {})
      }
    }),
    prisma.user.findFirst({
      where: {
        email: normalizedEmail,
        deleted_at: null
      },
      select: {
        id: true,
        email: true
      }
    })
  ]);

  if (currentUser?.email?.toLowerCase() === normalizedEmail) {
    throw ApiError.conflict('You cannot use your own email address for a contact', {
      code: ERROR_CODES.CONFLICT,
      details: [{
        field: 'email',
        message: 'A contact email cannot match the signed-in user email'
      }]
    });
  }

  if (existingContact) {
    throwContactEmailConflict(existingContact, 'A contact already exists with this email address');
  }

  if (!platformUser) return;

  const linkedContact = await findContactLinkedToUser(profileId, platformUser.id, options);
  if (!linkedContact && !options.rejectUnlinkedPlatformUser) return;

  throwContactEmailConflict(
    linkedContact || { id: null, name: null, email: platformUser.email, phone: null },
    linkedContact
      ? 'This email belongs to a platform user already linked to a contact'
      : 'This email belongs to an existing platform user. Connect the contact instead of sending an invite.'
  );
}

async function findActiveUserForContactFlow(userId) {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      deleted_at: null
    },
    include: {
      user_setting: true
    }
  });

  if (!user) {
    throw ApiError.notFound('User not found', {
      code: ERROR_CODES.USER_NOT_FOUND
    });
  }

  return user;
}

function isIncomingContactRequestForUser(contact, user, userPhoneDigits = null) {
  const metadata = getContactMetadata(contact);
  const request = getRelationshipRequest(metadata);

  if (metadata.connection_status === 'pending') {
    return request?.status === 'pending' && request.target_user_id === user.id;
  }

  if (metadata.connection_status !== 'invited') return false;

  if (request?.status !== 'pending') return false;

  const invitedEmail = normalizeNullableString(request.invite?.email)?.toLowerCase();
  if (invitedEmail && invitedEmail === user.email?.toLowerCase()) return true;

  const invitedPhoneDigits = normalizePhoneDigits(request.invite?.phone);
  return Boolean(invitedPhoneDigits && userPhoneDigits && invitedPhoneDigits === userPhoneDigits);
}

function buildRelationshipRequestMetadata({
  type,
  status,
  requestedByUserId,
  targetUserId = null,
  targetEmail = null,
  inviteEmail = null,
  invitePhone = null
}) {
  const now = new Date().toISOString();
  return {
    type,
    status,
    requested_by_user_id: requestedByUserId || null,
    target_user_id: targetUserId,
    target_email: targetEmail,
    invite: {
      email: inviteEmail || null,
      phone: invitePhone || null
    },
    requested_at: now,
    accepted_by_user_id: null,
    accepted_at: null
  };
}

function buildAcceptedRelationshipRequestMetadata(contact, acceptedByUserId) {
  const request = getRelationshipRequest(getContactMetadata(contact)) || {};

  return {
    ...request,
    status: 'accepted',
    target_user_id: acceptedByUserId,
    accepted_by_user_id: acceptedByUserId,
    accepted_at: new Date().toISOString()
  };
}

function getRelationshipRequest(metadata) {
  const relationship = metadata.relationship_metadata || {};
  if (relationship.request && typeof relationship.request === 'object' && !Array.isArray(relationship.request)) {
    return relationship.request;
  }

  if (relationship.invitation) {
    return {
      type: 'invitation',
      status: relationship.invitation.status || relationship.status || null,
      requested_by_user_id: relationship.invitation.invited_by_user_id || null,
      target_user_id: null,
      target_email: null,
      invite: {
        email: relationship.invitation.email || null,
        phone: relationship.invitation.phone || null
      },
      requested_at: relationship.invitation.invited_at || null,
      accepted_by_user_id: relationship.invitation.accepted_by_user_id || null,
      accepted_at: relationship.invitation.accepted_at || null
    };
  }

  if (relationship.target_user_id) {
    return {
      type: 'connection_request',
      status: relationship.status || null,
      requested_by_user_id: relationship.requested_by_user_id || null,
      target_user_id: relationship.target_user_id,
      target_email: null,
      invite: {
        email: null,
        phone: null
      },
      requested_at: relationship.requested_at || null,
      accepted_by_user_id: relationship.accepted_by_user_id || null,
      accepted_at: relationship.accepted_at || null
    };
  }

  return null;
}

function throwContactEmailConflict(contact, message) {
  throw ApiError.conflict(message, {
    code: ERROR_CODES.CONFLICT,
    details: [{
      field: 'email',
      message: 'A profile can use an email address for only one contact',
      contact: {
        id: contact.id,
        name: contact.name,
        email: contact.email,
        phone: contact.phone
      }
    }]
  });
}

function buildContactWhere(profileId, query = {}) {
  const where = {
    profile_id: profileId,
    deleted_at: null
  };

  if (query.groupName) {
    where.group_name = query.groupName;
  }

  if (query.contactType) {
    where.contact_type = query.contactType;
  }

  if (query.search) {
    const search = String(query.search).trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { group_name: { contains: search, mode: 'insensitive' } }
      ];
    }
  }

  return where;
}

function buildContactOrder(orderBy) {
  const raw = String(orderBy || 'name');
  const descending = raw.startsWith('-');
  const field = descending ? raw.slice(1) : raw;

  if (!CONTACT_SORT_FIELDS.has(field)) {
    return [{ name: 'asc' }, { created_at: 'desc' }];
  }

  return [{ [field]: descending ? 'desc' : 'asc' }, { created_at: 'desc' }];
}

function buildContactData(input = {}, options = {}) {
  const data = {};
  const stringFields = [
    'name',
    'contact_type',
    'email',
    'phone',
    'website',
    'avatar_url',
    'group_name',
    'notes'
  ];

  stringFields.forEach((field) => {
    if (input[field] !== undefined) {
      if (field === 'name' && options.partial && !String(input[field] || '').trim()) {
        throw ApiError.badRequest('Contact name cannot be blank', {
          code: ERROR_CODES.VALIDATION_FAILED,
          details: [{ location: 'body', field: 'name', message: 'Must not be blank' }]
        });
      }
      data[field] = field === 'email'
        ? normalizeNullableString(input[field])?.toLowerCase() || null
        : normalizeNullableString(input[field]);
    }
  });

  if (input.displayName !== undefined && input.name === undefined) {
    if (options.partial && !String(input.displayName || '').trim()) {
      throw ApiError.badRequest('Contact name cannot be blank', {
        code: ERROR_CODES.VALIDATION_FAILED,
        details: [{ location: 'body', field: 'displayName', message: 'Must not be blank' }]
      });
    }
    data.name = normalizeNullableString(input.displayName);
  }

  const metadataUpdates = {};

  CONTACT_METADATA_FIELDS.forEach((field) => {
    if (input[field] !== undefined) {
      metadataUpdates[field] = input[field] ?? null;
    }
  });

  if (input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)) {
    Object.assign(metadataUpdates, input.metadata);
  }

  if (Object.keys(metadataUpdates).length > 0) {
    data.metadata = options.partial
      ? metadataUpdates
      : metadataUpdates;
  }

  return data;
}

function normalizeNullableString(value) {
  if (value === null) return null;
  if (value === undefined) return undefined;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function normalizePhoneDigits(value) {
  if (!value) return null;
  const digits = String(value).replace(/\D/g, '');
  return digits || null;
}

async function uploadContactAvatar(file, context) {
  if (!file?.buffer?.length) return null;

  const contentType = file.mimetype || file.contentType || 'application/octet-stream';
  const fileName = file.originalname || file.originalName || 'contact-avatar';

  if (!String(contentType).toLowerCase().startsWith('image/')) {
    throw ApiError.badRequest('Contact avatar must be an image file', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'avatar', message: 'Must be an image file' }]
    });
  }

  if (file.size > CONTACT_AVATAR_MAX_BYTES) {
    throw ApiError.badRequest('Contact avatar is too large', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'avatar', message: 'Must be 5MB or smaller' }]
    });
  }

  return uploadPublicObject({
    category: 'contact-avatars',
    profileId: context.profileId,
    fileName,
    contentType,
    fileSize: file.size,
    body: file.buffer
  }, {
    userId: context.userId,
    publicFilesBaseUrl: context.publicFilesBaseUrl
  });
}

async function deletePublicAvatar(avatarUrl) {
  const key = extractKeyFromPublicUrl(avatarUrl);
  if (!key) return;

  try {
    await deleteObject(key);
  } catch (error) {
    console.error('Failed to delete contact avatar:', error);
  }
}

function getContactMetadata(contact) {
  return contact.metadata && typeof contact.metadata === 'object' && !Array.isArray(contact.metadata)
    ? contact.metadata
    : {};
}

function mergeContactMetadata(contact, updates) {
  return {
    ...getContactMetadata(contact),
    ...updates
  };
}

function pickPublicDetectedUser(user, phoneDigits = null) {
  return {
    id: user.id,
    email: user.email,
    phone: phoneDigits || null,
    name: user.full_name || user.email,
    avatar: user.avatar_url || null
  };
}

function pickPublicContact(contact) {
  const metadata = getContactMetadata(contact);

  return {
    id: contact.id,
    profile_id: contact.profile_id,
    name: contact.name,
    contact_type: contact.contact_type,
    email: contact.email,
    phone: contact.phone,
    website: contact.website,
    avatar_url: contact.avatar_url,
    group_name: contact.group_name,
    notes: contact.notes,
    metadata,
    address: metadata.address || null,
    status: metadata.status || 'active',
    tags: Array.isArray(metadata.tags) ? metadata.tags : [],
    color: metadata.color || '#6B7280',
    linked_user_id: metadata.linked_user_id || null,
    connection_status: metadata.connection_status || 'not_checked',
    relationship_metadata: metadata.relationship_metadata || null,
    created_at: contact.created_at,
    updated_at: contact.updated_at
  };
}

module.exports = {
  listContactsForProfile,
  getContactForProfile,
  listIncomingContactRequestsForUser,
  createContactForProfile,
  updateContactForProfile,
  deleteContactForProfile,
  withdrawContactRequestForProfile,
  detectContactAccountForProfile,
  requestContactConnectionForProfile,
  inviteContactForProfile,
  acceptIncomingContactRequestForUser,
  pickPublicContact
};
