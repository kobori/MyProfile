Friendship = new Meteor.Collection('friendships');

Friendship.follow = function(friendId) {
 var params = {
  userId: Meteor.userId(),
  friendId: friendId
 };
 this.insert(params);
 winston.info("Friendship.follow: ", params);
};

Friendship.unfollow = function(friendId) {
 var params = {
  userId: Meteor.userId(),
  friendId: friendId
 };
 this.remove(params);
 winston.info("Friendship.unfollow: ", params);
};

Friendship.isFollowing = function(friendId) {
 return this.findOneFaster({
  userId: Meteor.userId(),
  friendId: friendId
 });
};

Friendship.followings = function(userId) {
 return this.find({userId: userId}).count();
};

Friendship.followers = function(friendId) {
 return this.find({friendId: friendId}).count();
};

Friendship.timelineIds = function(userId) {
 var timelineIds = this.find({
  userId: userId
 }).map(function(f) {
  return f.friendId;
 });
 timelineIds.push(userId);
 return timelineIds;
};

Friendship.followersAndFollowings = function(_id) {
  return this.find({
    $or: [{userId: _id}, {friendId: _id}]
  });
};















