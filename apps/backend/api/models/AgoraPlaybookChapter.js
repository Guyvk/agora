/**
 * Agora: one chapter of a group's playbook, for example "Onboarding" or
 * "Governance", with its owner (a member), its status, a short text and a
 * link. Its statuses and the rules for reading and changing chapters are in lib/agora/playbook.js.
 */

module.exports = bookshelf.Model.extend({
  tableName: 'agora_playbook_chapters',
  requireFetch: false,
  hasTimestamps: true,

  group: function () {
    return this.belongsTo(Group, 'group_id')
  },

  owner: function () {
    return this.belongsTo(User, 'owner_id')
  },

  updatedBy: function () {
    return this.belongsTo(User, 'updated_by_id')
  }
})
