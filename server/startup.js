Meteor.startup(function() {

  Meteor.publish("posts", function(_id) { 
    var _id = Meteor.userId();
    var timelineIds = Friendship.timelineIds(_id);
    return Post.list(timelineIds);
  });

  Meteor.publish("friendship", function(_id) {
    var _id = Meteor.userId()
    return Friendship.followersAndFollowings(_id);
  });

  
  Meteor.publish("isFollowing", function(_id) {
    var _id = Meteor.userId()
    return Friendship.isFollowing(_id);
  });
  

  Meteor.publish("user", function(_id) {
    return Meteor.users.find({_id: _id});
  });


})