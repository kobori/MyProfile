Router.route("/user/:_id", function() {
  var _id = this.params._id;  
  this.subscribe("user", _id);
  var isFollowing = Friendship.isFollowing(_id);
  Session.set("currentUserId", _id);
  Session.set("isFollowing", isFollowing);
  this.render("user", {
    data: function() {
      return {
        user: Meteor.users.findOne({_id: _id}),
        posts: Post.list([_id]),
        followers: Friendship.followers(_id),
        followings: Friendship.followings(_id)
      }
    }
  });
}, { 
  name: "user",
  fastRender: true
});
